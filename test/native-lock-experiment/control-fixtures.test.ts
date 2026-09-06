import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { constants, tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { hostedNativeLockControlIds } from "../../scripts/conformance/hosted-native-lock-plan.mjs";

/**
 * ISS-048 stage-three sub-slice 3.3. Nothing here compiles, loads or spawns a
 * native binary, loads an addon, requires a `.node`, runs a case, seals an
 * archive, or writes a report or workflow. Every witness call is synthetic
 * captured input supplied through the module's mockable boundary, and every
 * fixture child is a synthetic in-process stub: no real fixture child is
 * spawned and no real witness exists in this file. Nothing here is executable
 * evidence outside the hosted three-OS bootstrap.
 *
 * `probes/portable-primitives/experiment/*.mjs` are landed JavaScript modules
 * with no declaration file, and `tsconfig.json` sets no `allowJs`, so `tsc`
 * reports TS7016 for each import below. Sub-slice 3.3's footprint may not add a
 * declaration file or change the compiler configuration, so every one of them
 * is suppressed once and immediately bound to a locally declared shape.
 */

type Arm = Readonly<{ refused: boolean | null; result: string }>;
type ControlRecord = Readonly<{ controlId: string; refused: boolean | null; result: string }>;
type Substitutions = Readonly<{
  fixtures: boolean;
  gates: readonly string[];
  guards: readonly string[];
  seam: string;
  spawn: boolean;
}>;
type Observation = Readonly<{
  archiveRelativeInputPath: string | null;
  controlId: string;
  detail: string;
  evidence: string;
  guard: string | null;
  mutant: string | null;
  prerequisite: string | null;
  refused: boolean | null;
  result: string;
  substitutions: Substitutions;
  witnessDisposition: string | null;
}>;
type Census = Readonly<{
  files: ReadonlyArray<Readonly<{ path: string; value: unknown }>>;
  observations: readonly Observation[];
  records: readonly ControlRecord[];
}>;
type Fact = Readonly<{
  operation: string;
  returnValue: string;
  errorCode: string;
  identity: unknown;
  nativeHandle: string | null;
  nonInheritable: boolean | null;
}>;
type Claim = Readonly<{
  controlId: string;
  detail: string;
  heldClaim: boolean;
  releasedClaim: boolean;
  state: string;
}>;
type FixtureResult = Readonly<{
  claim: Claim | null;
  controlId: string;
  failure: string | null;
  interception: string | null;
  witnessFacts: readonly Fact[] | null;
}>;
type FixturePhase = Readonly<{
  openResources: readonly string[];
  resetFailure: string | null;
  results: readonly FixtureResult[];
  seamKind: string;
  spawnCount: number;
  witnessHeld: boolean;
}>;
type Prerequisites = Readonly<{ candidateBinding: string; custody: string; witness: string }>;
type Policy = Readonly<{
  claim: string;
  commands: readonly string[];
  controlId: string;
  corroboratingDisposition: string;
  interception: string;
  refutingDisposition: string;
}>;
type Journal = Readonly<{ isFrozen: boolean; freeze: () => string }>;
type Ledger = Readonly<{
  open: (name: string) => string;
  close: (name: string) => string;
  openNames: readonly string[];
}>;
type Boundary = Readonly<Record<string, unknown>>;
type ControlsModule = Readonly<{
  buildNativeLockControlCensus: (
    input: Readonly<{ prerequisites: Prerequisites }>,
    boundary?: Boundary,
  ) => Census;
  checkNativeLockControlCensus: (
    records: unknown,
    presentPaths: readonly string[],
  ) => readonly string[];
  deriveNativeLockControlPrerequisiteArm: (
    prerequisites: unknown,
  ) => Readonly<{ arm: Arm; prerequisite: string }>;
  enterNativeLockCasePhase: (seam: unknown, phase: unknown, boundary?: Boundary) => boolean;
  nativeLockControlPaths: (controlId: string) => Readonly<{
    inputPath: string;
    observationPath: string;
  }>;
  nativeLockControlPhaseGates: Readonly<Record<string, unknown>>;
  runNativeLockControlFixturePhase: (
    input: Readonly<{ prerequisites: Prerequisites }>,
    boundary?: Boundary,
  ) => Promise<FixturePhase | null>;
  runNativeLockControlPhase: (
    archiveRoot: string,
    input: Readonly<{ prerequisites: Prerequisites }>,
    boundary?: Boundary,
  ) => Promise<
    Readonly<{
      observations: readonly Observation[];
      openResources: readonly string[];
      records: readonly ControlRecord[];
      retained: readonly string[];
      seam: string;
      spawnCount: number;
      witnessHeld: boolean;
    }>
  >;
}>;
type FixturesModule = Readonly<{
  checkNativeLockCasePhaseEntry: (phase: unknown) => boolean;
  checkNativeLockControlDeathFreedom: (policies: unknown, spawnCount: number) => boolean;
  checkNativeLockControlFixtureCensus: (
    policies: unknown,
    expectedControlIds: readonly string[],
  ) => readonly string[];
  checkNativeLockControlReset: (ledger: unknown, journal: unknown) => boolean;
  createNativeLockControlResourceLedger: () => Ledger;
  judgeNativeLockControlFixture: (
    controlId: string,
    witnessFacts: unknown,
  ) => Readonly<{ disposition: string; verdict: string | null }>;
  nativeLockControlDeathCommands: readonly string[];
  nativeLockControlFixtureCommands: readonly string[];
  nativeLockControlFixturePolicies: readonly Policy[];
  nativeLockControlFixturePolicy: (controlId: string) => Policy;
  stableControlFixtureFiles: readonly string[];
}>;
type FactsModule = Readonly<{ record: (value: unknown, keys: readonly string[]) => unknown }>;
type CaptureModule = Readonly<{ measurement: () => Journal }>;

// @ts-expect-error TS7016: landed JavaScript module with no declaration file
import * as controlsSource from "../../probes/portable-primitives/experiment/controls.mjs";
// @ts-expect-error TS7016: landed JavaScript module with no declaration file
import * as fixturesSource from "../../probes/portable-primitives/experiment/control-fixtures.mjs";
// @ts-expect-error TS7016: landed JavaScript module with no declaration file
import * as factsSource from "../../probes/portable-primitives/experiment/facts.mjs";
// @ts-expect-error TS7016: landed JavaScript module with no declaration file
import * as captureSource from "../../probes/portable-primitives/experiment/capture.mjs";

const controls: ControlsModule = controlsSource;
const fixtures: FixturesModule = fixturesSource;
const facts: FactsModule = factsSource;
const capture: CaptureModule = captureSource;

const {
  buildNativeLockControlCensus,
  checkNativeLockControlCensus,
  deriveNativeLockControlPrerequisiteArm,
  enterNativeLockCasePhase,
  nativeLockControlPaths,
  runNativeLockControlFixturePhase,
  runNativeLockControlPhase,
} = controls;
const {
  checkNativeLockCasePhaseEntry,
  checkNativeLockControlDeathFreedom,
  checkNativeLockControlFixtureCensus,
  checkNativeLockControlReset,
  createNativeLockControlResourceLedger,
  judgeNativeLockControlFixture,
  nativeLockControlFixturePolicies,
  nativeLockControlFixturePolicy,
} = fixtures;

const execFileAsync = promisify(execFile);
const experimentRoot = resolve(import.meta.dirname, "../../probes/portable-primitives/experiment");
const available: Prerequisites = Object.freeze({
  candidateBinding: "AVAILABLE",
  custody: "AVAILABLE",
  witness: "AVAILABLE",
});
const witnessDependentIds = ["BYPASS_LOCK", "PREMATURE_UNLOCK", "RETAIN_AFTER_RELEASE"] as const;
const windows = process.platform === "win32";
const leafIdentity = windows
  ? { kind: "WINDOWS", volumeSerialNumber: "9", fileIdHex: "1".repeat(32) }
  : { kind: "POSIX", device: "9", inode: "11" };
const errorCodes: Readonly<Record<string, string>> = Object.freeze({
  ACQUIRED: "0",
  CONTENDED: windows ? "33" : String(constants.errno.EWOULDBLOCK),
  UNSUPPORTED: windows ? "50" : String(constants.errno.ENOSYS),
  UNKNOWN: windows ? "997" : String(constants.errno.EINVAL),
});
const witnessGuard =
  "probes/portable-primitives/experiment/control-fixtures.mjs#judgeNativeLockControlFixture";

/** One synthetic captured `TRY_LOCK` measurement. No native call produced it. */
function witnessCall(disposition: string): readonly Fact[] {
  return [
    Object.freeze({
      operation: "TRY_LOCK",
      returnValue: disposition === "ACQUIRED" ? (windows ? "1" : "0") : windows ? "0" : "-1",
      errorCode: errorCodes[disposition]!,
      identity: structuredClone(leafIdentity),
      nativeHandle: "31",
      nonInheritable: true,
    }),
  ];
}

/** The refuting witness outcome of each fixture, in the landed census order. */
const refutingRun = ["ACQUIRED", "ACQUIRED", "CONTENDED"] as const;
const corroboratingRun = ["CONTENDED", "CONTENDED", "ACQUIRED"] as const;

type SeamState = { cases: number; locked: boolean; resets: number; spawns: number };
type Seam = Readonly<Record<string, unknown>> & { state: SeamState };

/**
 * A synthetic control-phase seam with the landed case context's own ordering
 * rules. It is not a case context, so the module must stamp every row it backs
 * as a substituted seam and never as a landed witness call.
 */
function makeSeam(dispositions: readonly string[]): Seam {
  const state: SeamState = { cases: 0, locked: false, resets: 0, spawns: 0 };
  let journal: Journal | null = null;
  let index = 0;
  const refuse = (): never => {
    throw new Error("native-lock-fixture:refused");
  };
  const seam = {
    state,
    artifactRoot: windows ? "C:\\artifact" : "/artifact",
    rootPath: windows ? "C:\\root" : "/root",
    identity: structuredClone(leafIdentity),
    beginControl(): Journal {
      if (state.locked || (journal !== null && !journal.isFrozen)) refuse();
      journal = capture.measurement();
      return journal;
    },
    barrier(value: unknown): void {
      if (value !== journal) refuse();
    },
    tryWitness(value: unknown): readonly Fact[] {
      if (value !== journal || state.locked) refuse();
      const disposition = dispositions[index++]!;
      if (disposition === "ACQUIRED") state.locked = true;
      return witnessCall(disposition);
    },
    resetControl(): void {
      if (journal === null || !journal.isFrozen) refuse();
      state.resets += 1;
      state.locked = false;
    },
    beginCases(): void {
      if (state.locked) refuse();
      state.cases += 1;
    },
    spawn(): never {
      state.spawns += 1;
      return refuse();
    },
  };
  return seam as unknown as Seam;
}

type Child = EventEmitter & {
  send: (message: { name: string; sequence: string }, callback?: () => void) => void;
};

function claimFor(policy: Policy, honest: boolean): Claim {
  const retains = policy.controlId === "RETAIN_AFTER_RELEASE";
  return Object.freeze({
    controlId: policy.controlId,
    detail: policy.interception,
    heldClaim: honest ? !retains : retains,
    releasedClaim: honest ? retains : !retains,
    state: honest ? (retains ? "OPEN" : "LOCKED") : retains ? "LOCKED" : "OPEN",
  });
}

/** A synthetic fixture child. No process is spawned anywhere in this file. */
function makeChild(policy: Policy, honest: boolean): Child {
  const child = new EventEmitter() as Child;
  child.send = (message, callback) => {
    setImmediate(() => {
      child.emit("message", {
        claim: claimFor(policy, honest),
        controlId: policy.controlId,
        interception: policy.interception,
        name: message.name,
        sequence: message.sequence,
      });
      if (message.name === "CLOSE") setImmediate(() => child.emit("close", 0, null));
    });
    callback?.();
  };
  return child;
}

const fixtureChild = Object.freeze({
  stableFiles: fixtures.stableControlFixtureFiles.map((path) => ({
    path,
    byteLength: "1",
    sha256: "0".repeat(64),
  })),
  systemRoot: null,
  witness: {
    path: "builds/STABLE_WITNESS/native-lock-witness.node",
    byteLength: "1",
    sha256: "0".repeat(64),
  },
});

function boundaryFor(seam: Seam, honest = true, extra: Boundary = {}): Boundary {
  return {
    fixtureChild,
    seam,
    spawn: (configuration: { controlId: string }) =>
      makeChild(nativeLockControlFixturePolicy(configuration.controlId), honest),
    watchdogMs: 2_000,
    ...extra,
  };
}

const resultOf = (records: readonly ControlRecord[], controlId: string): string | undefined =>
  records.find((row) => row.controlId === controlId)?.result;
const armsOf = (phase: FixturePhase): readonly ControlRecord[] =>
  buildNativeLockControlCensus(
    { prerequisites: available },
    { fixtureResults: phase.results },
  ).records.slice(0, 3);

describe("ISS-048 control phase and call-interception fixtures", () => {
  let temporary = "";

  beforeEach(async () => {
    temporary = await mkdtemp(resolve(tmpdir(), "iss048-control-fixtures-"));
  });
  afterEach(async () => {
    if (temporary) await rm(temporary, { force: true, recursive: true });
  });

  test("loads the fixture module under bare Node and keeps the control census out of its graph", async () => {
    const target = resolve(experimentRoot, "control-fixtures.mjs");
    const script = [
      `const module = await import(${JSON.stringify(pathToFileURL(target).href)});`,
      `const ids = ${JSON.stringify(witnessDependentIds)};`,
      `if (!ids.every((id) => module.nativeLockControlFixturePolicy(id).controlId === id))`,
      `  throw new Error("fixture-census-refused");`,
      `console.log("bare-node-load-ok");`,
    ].join("\n");
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--input-type=module", "-e", script],
      { timeout: 60_000 },
    );
    expect(stdout).toContain("bare-node-load-ok");

    // The three fixtures run as bare-Node children, so the module's import
    // graph must stay inside `node:` builtins and the two landed bare-Node
    // modules. `controls.mjs`, `scripts/conformance/*.mts` and
    // `packages/conformance/src` resolve only under esbuild or Vitest.
    const source = await readFile(target, "utf8");
    expect([...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map((match) => match[1]!).sort()).toEqual([
      "./facts.mjs",
      "./io.mjs",
      "node:child_process",
      "node:path",
      "node:url",
    ]);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(fixtures.nativeLockControlFixturePolicies.map((policy) => policy.controlId)).toEqual([
      ...witnessDependentIds,
    ]);
    expect([...hostedNativeLockControlIds].slice(0, 3)).toEqual([...witnessDependentIds]);
  }, 60_000);

  test("refuses each fixture's claim by a real witness call and never by its own report", async () => {
    const honest = await runNativeLockControlFixturePhase(
      { prerequisites: available },
      boundaryFor(makeSeam(refutingRun), true),
    );
    const flipped = await runNativeLockControlFixturePhase(
      { prerequisites: available },
      boundaryFor(makeSeam(refutingRun), false),
    );
    for (const controlId of witnessDependentIds)
      expect(resultOf(armsOf(honest!), controlId), controlId).toBe("REFUSED");
    // The two runs differ only in what the fixtures said about themselves.
    expect(honest!.results.map((row) => row.claim)).not.toEqual(
      flipped!.results.map((row) => row.claim),
    );
    expect(armsOf(flipped!)).toEqual(armsOf(honest!));
    // The judge has no parameter for the claim, so no path reaches it.
    expect(judgeNativeLockControlFixture.length).toBe(2);
    for (const [index, controlId] of witnessDependentIds.entries()) {
      const policy = nativeLockControlFixturePolicy(controlId);
      expect(
        judgeNativeLockControlFixture(controlId, witnessCall(refutingRun[index]!)),
        controlId,
      ).toEqual({ disposition: policy.refutingDisposition, verdict: "REFUSED" });
    }
  });

  test("treats a fixture reporting success while the witness contends as VIOLATED", async () => {
    const phase = await runNativeLockControlFixturePhase(
      { prerequisites: available },
      boundaryFor(makeSeam(corroboratingRun), true),
    );
    for (const [index, controlId] of witnessDependentIds.entries()) {
      expect(resultOf(armsOf(phase!), controlId), controlId).toBe("VIOLATED");
      expect(
        judgeNativeLockControlFixture(controlId, witnessCall(corroboratingRun[index]!)).verdict,
      ).toBe("VIOLATED");
    }
    const census = buildNativeLockControlCensus(
      { prerequisites: available },
      { fixtureResults: phase!.results },
    );
    for (const observation of census.observations.slice(0, 3)) {
      expect(observation.refused, observation.controlId).toBe(false);
      expect(observation.result, observation.controlId).toBe("VIOLATED");
      expect(observation.archiveRelativeInputPath, observation.controlId).not.toBeNull();
    }
  });

  test("emits the nullable arm from the same stable prerequisite facts with no witness", async () => {
    const absent = buildNativeLockControlCensus({ prerequisites: available });
    for (const controlId of witnessDependentIds) {
      const observation = absent.observations.find((row) => row.controlId === controlId)!;
      expect(observation.result, controlId).toBe("UNKNOWN");
      expect(observation.evidence, controlId).toBe("STABLE_PREREQUISITE_DERIVATION");
      expect(observation.substitutions.seam, controlId).toBe("ABSENT");
      expect(observation.archiveRelativeInputPath, controlId).toBeNull();
    }
    for (const [disposition, prerequisites, expected] of [
      ["UNSUPPORTED", available, "UNKNOWN"],
      ["UNKNOWN", available, "UNKNOWN"],
      ["UNSUPPORTED", { ...available, witness: "UNSUPPORTED" }, "UNSUPPORTED"],
      ["UNKNOWN", { ...available, custody: "UNSUPPORTED" }, "UNSUPPORTED"],
    ] as const) {
      const phase = await runNativeLockControlFixturePhase(
        { prerequisites },
        boundaryFor(makeSeam([disposition, disposition, disposition]), true),
      );
      const census = buildNativeLockControlCensus(
        { prerequisites },
        { fixtureResults: phase!.results },
      );
      const derived = deriveNativeLockControlPrerequisiteArm(prerequisites);
      for (const controlId of witnessDependentIds) {
        const observation = census.observations.find((row) => row.controlId === controlId)!;
        expect(observation.result, `${disposition}:${controlId}`).toBe(expected);
        expect(observation.refused, controlId).toBeNull();
        expect(observation.prerequisite, controlId).toBe(derived.prerequisite);
        expect(observation.witnessDisposition, controlId).toBe(disposition);
        // An unavailable row keeps its observation and forbids its input file.
        expect(observation.archiveRelativeInputPath, controlId).toBeNull();
      }
      expect(census.files).toHaveLength(21);
      for (const controlId of [...hostedNativeLockControlIds].slice(3))
        expect(resultOf(census.records, controlId), controlId).toBe("REFUSED");
    }
  });

  test("refuses the control reset with an open resource or an unfrozen journal", async () => {
    const ledger = createNativeLockControlResourceLedger();
    const frozen = capture.measurement();
    frozen.freeze();
    expect(checkNativeLockControlReset(ledger, frozen)).toBe(true);
    ledger.open("BYPASS_LOCK:child");
    expect(() => checkNativeLockControlReset(ledger, frozen)).toThrow(
      "native-lock-fixture:refused",
    );
    ledger.close("BYPASS_LOCK:child");
    expect(() => checkNativeLockControlReset(ledger, capture.measurement())).toThrow(
      "native-lock-fixture:refused",
    );
    // Deletion mutant: the same composition with the open-resource clause gone.
    const deleted = (_ledger: Ledger, journal: Journal): boolean => {
      if (journal.isFrozen !== true) throw new Error("native-lock-fixture:refused");
      return true;
    };
    const open = createNativeLockControlResourceLedger();
    open.open("BYPASS_LOCK:child");
    expect(deleted(open, frozen)).toBe(true);

    // A child that never closes leaves its resource open, so the reset refuses,
    // the phase reports the witness as still held, and the case phase stays shut.
    const seam = makeSeam(refutingRun);
    const phase = await runNativeLockControlFixturePhase(
      { prerequisites: available },
      boundaryFor(seam, true, {
        spawn: () => {
          const child = new EventEmitter() as Child;
          child.send = () => {};
          return child;
        },
        watchdogMs: 25,
      }),
    );
    expect(phase!.openResources.length).toBeGreaterThan(0);
    expect(phase!.resetFailure).toEqual(expect.any(String));
    expect(phase!.witnessHeld).toBe(true);
    expect(() => enterNativeLockCasePhase(seam, phase)).toThrow("native-lock-fixture:refused");
    expect(seam.state.cases).toBe(0);
  });

  test("refuses the case phase when a control left the witness locked", () => {
    expect(checkNativeLockCasePhaseEntry({ openResources: [], witnessHeld: false })).toBe(true);
    expect(() => checkNativeLockCasePhaseEntry({ openResources: [], witnessHeld: true })).toThrow(
      "native-lock-fixture:refused",
    );
    expect(() =>
      checkNativeLockCasePhaseEntry({ openResources: ["BYPASS_LOCK:child"], witnessHeld: false }),
    ).toThrow("native-lock-fixture:refused");
    // Deletion mutant: the same composition with the witness clause gone.
    const deleted = (phase: { openResources: readonly string[] }): boolean => {
      facts.record(phase, ["openResources", "witnessHeld"]);
      if (phase.openResources.length !== 0) throw new Error("native-lock-fixture:refused");
      return true;
    };
    expect(deleted({ openResources: [], witnessHeld: true } as never)).toBe(true);
    const seam = makeSeam(refutingRun);
    expect(() => enterNativeLockCasePhase(seam, { openResources: [], witnessHeld: true })).toThrow(
      "native-lock-fixture:refused",
    );
    expect(seam.state.cases).toBe(0);
  });

  test("runs no second holder-death attempt in any control", async () => {
    const policies = nativeLockControlFixturePolicies;
    for (const policy of policies) {
      expect([...policy.commands], policy.controlId).toEqual(["READY", "CLOSE"]);
      for (const forbidden of fixtures.nativeLockControlDeathCommands)
        expect(policy.commands, policy.controlId).not.toContain(forbidden);
    }
    expect(checkNativeLockControlDeathFreedom(policies, 0)).toBe(true);
    expect(() => checkNativeLockControlDeathFreedom(policies, 1)).toThrow(
      "native-lock-fixture:refused",
    );
    expect(() =>
      checkNativeLockControlDeathFreedom(
        policies.map((policy, index) =>
          index === 0 ? { ...policy, commands: ["READY", "SPAWN_DEFAULT_CHILD"] } : policy,
        ),
        0,
      ),
    ).toThrow("native-lock-fixture:refused");
    // Deletion mutant: the gate removed entirely.
    const deleted = (): boolean => true;
    expect(deleted()).toBe(true);
    expect(() =>
      buildNativeLockControlCensus({ prerequisites: available }, { spawnCount: 1 }),
    ).toThrow("native-lock-fixture:refused");

    const seam = makeSeam(refutingRun);
    const phase = await runNativeLockControlFixturePhase(
      { prerequisites: available },
      boundaryFor(seam, true),
    );
    expect(phase!.spawnCount).toBe(0);
    // The landed case-actor spawn, the only path to a holder-death fixture, is
    // never invoked by any control.
    expect(seam.state.spawns).toBe(0);
    expect(seam.state.resets).toBe(3);
  });

  test("binds each fixture to its landed control ID", () => {
    const policies = nativeLockControlFixturePolicies;
    expect(checkNativeLockControlFixtureCensus(policies, [...witnessDependentIds])).toEqual([
      ...witnessDependentIds,
    ]);
    for (const wrong of [
      ["PREMATURE_UNLOCK", "BYPASS_LOCK", "RETAIN_AFTER_RELEASE"],
      ["BYPASS_LOCK", "PREMATURE_UNLOCK"],
      ["BYPASS_LOCK", "PREMATURE_UNLOCK", "OTHER"],
    ])
      expect(() => checkNativeLockControlFixtureCensus(policies, wrong), wrong.join(",")).toThrow(
        "native-lock-fixture:refused",
      );
    expect(() =>
      checkNativeLockControlFixtureCensus(
        policies.map((policy, index) =>
          index === 0 ? { ...policy, commands: ["READY", "ACQUIRE"] } : policy,
        ),
        [...witnessDependentIds],
      ),
    ).toThrow("native-lock-fixture:refused");
    // Deletion mutant: length only, no name binding, so a reorder is accepted.
    const deleted = (rows: readonly Policy[], expected: readonly string[]): readonly string[] => {
      if (rows.length !== expected.length) throw new Error("native-lock-fixture:refused");
      return rows.map((row) => row.controlId);
    };
    expect(deleted(policies, ["PREMATURE_UNLOCK", "BYPASS_LOCK", "RETAIN_AFTER_RELEASE"])).toEqual([
      ...witnessDependentIds,
    ]);
    expect(() =>
      buildNativeLockControlCensus(
        { prerequisites: available },
        { fixtures: policies.map((policy) => ({ ...policy, controlId: "OTHER" })) },
      ),
    ).toThrow("native-lock-fixture:refused");
  });

  test("never stamps a caller-supplied result as a landed-seam witness call", () => {
    const forged = witnessDependentIds.map((controlId, index) => ({
      claim: null,
      controlId,
      failure: null,
      interception: null,
      seamKind: "LANDED_CASE_CONTEXT",
      witnessFacts: witnessCall(refutingRun[index]!),
    }));
    const census = buildNativeLockControlCensus(
      { prerequisites: available },
      { fixtureResults: forged },
    );
    for (const observation of census.observations.slice(0, 3)) {
      expect(observation.evidence, observation.controlId).toBe(
        "SYNTHETIC_WITNESS_CALL_INTERCEPTION",
      );
      expect(observation.substitutions.seam, observation.controlId).toBe("CAPTURED_INPUT");
      expect(observation.result, observation.controlId).not.toBe("OBSERVED");
    }
    // Deletion mutant: a stamp that trusts the caller's own `seamKind`.
    const mutated = buildNativeLockControlCensus(
      { prerequisites: available },
      {
        fixtureResults: forged,
        gates: { seamKind: (result: { seamKind: string }) => result.seamKind },
      },
    );
    expect(mutated.observations[0]!.evidence).toBe("WITNESS_CALL_INTERCEPTION");
    // A result whose control ID does not match its census row refuses.
    expect(() =>
      buildNativeLockControlCensus(
        { prerequisites: available },
        { fixtureResults: [forged[1], forged[0], forged[2]] },
      ),
    ).toThrow("native-lock-fixture:refused");
    expect(() =>
      buildNativeLockControlCensus(
        { prerequisites: available },
        { fixtureResults: forged.slice(0, 2) },
      ),
    ).toThrow("native-lock-fixture:refused");
  });

  test("records every caller-supplied boundary substitution in the retained observation", async () => {
    const seam = makeSeam(refutingRun);
    const archiveRoot = resolve(temporary, "preparation");
    const phase = await runNativeLockControlPhase(
      archiveRoot,
      { prerequisites: available },
      boundaryFor(seam, true),
    );
    expect(phase.seam).toBe("SUBSTITUTED_SEAM");
    for (const observation of phase.observations) {
      expect(observation.substitutions.spawn, observation.controlId).toBe(true);
      expect(observation.substitutions.gates, observation.controlId).toEqual([]);
      expect(observation.substitutions.guards, observation.controlId).toEqual([]);
    }
    const substituted = buildNativeLockControlCensus(
      { prerequisites: available },
      { gates: { judge: judgeNativeLockControlFixture }, guards: {} },
    );
    expect(substituted.observations[0]!.substitutions.gates).toEqual(["judge"]);
  });

  test("writes the fixed control files for an executed witness row and enters the case phase", async () => {
    const seam = makeSeam(refutingRun);
    const archiveRoot = resolve(temporary, "preparation");
    const phase = await runNativeLockControlPhase(
      archiveRoot,
      { prerequisites: available },
      boundaryFor(seam, true),
    );
    expect(phase.records.map((row) => row.controlId)).toEqual([...hostedNativeLockControlIds]);
    for (const controlId of witnessDependentIds) {
      expect(resultOf(phase.records, controlId), controlId).toBe("REFUSED");
      expect((await readdir(resolve(archiveRoot, "controls", controlId))).sort()).toEqual([
        "input.json",
        "observation.json",
      ]);
      const observation: unknown = JSON.parse(
        await readFile(resolve(archiveRoot, "controls", controlId, "observation.json"), "utf8"),
      );
      expect(observation).toMatchObject({
        controlId,
        evidence: "SYNTHETIC_WITNESS_CALL_INTERCEPTION",
        guard: witnessGuard,
        refused: true,
        result: "REFUSED",
      });
      const retained = JSON.parse(
        await readFile(resolve(archiveRoot, "controls", controlId, "input.json"), "utf8"),
      ) as Readonly<{ claim: Claim; witnessFacts: readonly Fact[] }>;
      // The replayable input keeps both the fixture's claim and the real
      // witness transcript; only the second one decided the arm.
      expect(retained.claim.controlId).toBe(controlId);
      expect(retained.witnessFacts).toHaveLength(1);
      expect(retained.witnessFacts[0]!.operation).toBe("TRY_LOCK");
    }
    expect(phase.retained).toHaveLength(24);
    expect(checkNativeLockControlCensus(phase.records, phase.retained)).toEqual([]);
    expect(phase.openResources).toEqual([]);
    expect(phase.witnessHeld).toBe(false);
    expect(enterNativeLockCasePhase(seam, phase)).toBe(true);
    expect(seam.state.cases).toBe(1);
  });

  test("leaves the twelve-row census, its arms and its fixed paths unchanged", () => {
    const census = buildNativeLockControlCensus({ prerequisites: available });
    expect(census.records.map((row) => row.controlId)).toEqual([...hostedNativeLockControlIds]);
    for (const row of census.records)
      expect(Object.keys(row).sort()).toEqual(["controlId", "refused", "result"]);
    expect(census.files).toHaveLength(21);
    expect(census.observations.filter((row) => row.result === "REFUSED")).toHaveLength(9);
    for (const observation of census.observations) {
      expect(observation.result).not.toBe("OBSERVED");
      expect(Object.keys(observation)).not.toContain("facts");
      expect(Object.keys(observation)).not.toContain("events");
    }
    for (const controlId of hostedNativeLockControlIds)
      expect(nativeLockControlPaths(controlId)).toEqual({
        inputPath: `controls/${controlId}/input.json`,
        observationPath: `controls/${controlId}/observation.json`,
      });
  });
});

import type { ContractRecord } from "@orchestration-platform/contracts";
import { parseConformanceVectorCensus } from "./contracts.js";
import { iss002VectorIds, type Iss002VectorId } from "./stable.js";

export interface Iss002StableVectorSelection {
  readonly fixtureId: Iss002VectorId;
  readonly testFiles: readonly string[];
}

export interface Iss002StableExecutionResult {
  readonly normalizedResult: "FAIL" | "PASS" | "UNSUPPORTED";
  readonly stderrBytes: Uint8Array;
  readonly stdoutBytes: Uint8Array;
  readonly walkDurationsNanoseconds: readonly string[] | null;
}

export interface Iss002StableHandlerDependencies {
  readonly executeContracts: (
    selection: Iss002StableVectorSelection,
    generatedFixture: unknown,
  ) => Promise<Iss002StableExecutionResult>;
  readonly executeWalk: (
    selection: Iss002StableVectorSelection,
    generatedFixture: unknown,
  ) => Promise<Iss002StableExecutionResult>;
  readonly generate: (parameters: unknown) => unknown;
}

export type Iss002StableHandlerResult =
  | {
      readonly ok: true;
      readonly stderrBytes: Uint8Array;
      readonly stdoutBytes: Uint8Array;
      readonly vectorExecutions: readonly Readonly<{
        fixtureId: Iss002VectorId;
        normalizedResult: "FAIL" | "PASS" | "UNSUPPORTED";
      }>[];
      readonly walkDurationsNanoseconds: readonly string[] | null;
    }
  | { readonly ok: false; readonly issues: readonly string[] };

const selections: Readonly<Record<Iss002VectorId, readonly string[]>> = Object.freeze({
  "authority-history-linear": Object.freeze(["test/contracts/authority.test.ts"]),
  "authority-rotation-resting-cas-armed": Object.freeze(["test/contracts/commit.test.ts"]),
  "bootstrap-e0-core-post": Object.freeze(["test/contracts/genesis.test.ts"]),
  "canonical-decimal-boundaries": Object.freeze(["test/contracts/vocabulary.test.ts"]),
  "canonical-framing-boundaries": Object.freeze(["test/contracts/vocabulary.test.ts"]),
  "commit-run-single-epoch-prefixes": Object.freeze(["test/contracts/commit.test.ts"]),
  "destination-owner-race": Object.freeze(["test/contracts/owner.test.ts"]),
  "external-ledger-literals": Object.freeze(["test/contracts/external.test.ts"]),
  "full-required-loss": Object.freeze(["test/contracts/pointer.test.ts"]),
  "physical-destination-profile": Object.freeze(["test/contracts/owner.test.ts"]),
  "pointer-digest-domains": Object.freeze(["test/contracts/pointer.test.ts"]),
  "pointer-kind-census": Object.freeze(["test/contracts/vocabulary.test.ts"]),
  "pointer-packet-purpose-handle": Object.freeze(["test/contracts/pointer.test.ts"]),
  "recovery-archives-tombstones": Object.freeze(["test/contracts/recovery-archive.test.ts"]),
  "recovery-attempt-descriptor": Object.freeze(["test/contracts/attempt-descriptor.test.ts"]),
  "recovery-attempt-log": Object.freeze(["test/contracts/attempt-log.test.ts"]),
  "recovery-attempt-reservation": Object.freeze([
    "test/contracts/reservation-identity.test.ts",
    "test/contracts/reservation-value.test.ts",
  ]),
  "recovery-authorization-core": Object.freeze(["test/contracts/recovery-core.test.ts"]),
  "reflective-arrays": Object.freeze(["test/contracts/runtime.test.ts"]),
  "reflective-records": Object.freeze(["test/contracts/runtime.test.ts"]),
  "run-current-crash-prefixes": Object.freeze(["test/contracts/commit.test.ts"]),
  "walk-1000-records": Object.freeze([]),
});

export const iss002StableVectorSelections = Object.freeze(
  iss002VectorIds.map((fixtureId) =>
    Object.freeze({ fixtureId, testFiles: selections[fixtureId] }),
  ),
);

function refusal(...issues: readonly string[]): Iss002StableHandlerResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function exactBytes(input: unknown): input is Uint8Array {
  return input instanceof Uint8Array && Object.getPrototypeOf(input) === Uint8Array.prototype;
}

function validExecution(
  input: Iss002StableExecutionResult,
  walk: boolean,
): input is Iss002StableExecutionResult {
  if (
    !["FAIL", "PASS", "UNSUPPORTED"].includes(input.normalizedResult) ||
    !exactBytes(input.stderrBytes) ||
    !exactBytes(input.stdoutBytes)
  )
    return false;
  if (!walk) return input.walkDurationsNanoseconds === null;
  if (input.normalizedResult !== "PASS") return input.walkDurationsNanoseconds === null;
  return (
    Array.isArray(input.walkDurationsNanoseconds) &&
    input.walkDurationsNanoseconds.length === 3 &&
    input.walkDurationsNanoseconds.every(
      (value) =>
        typeof value === "string" &&
        /^(?:0|[1-9][0-9]*)$/.test(value) &&
        Number.isSafeInteger(Number(value)) &&
        BigInt(value) <= 5_000_000_000n,
    )
  );
}

function validGeneratedFixture(
  input: unknown,
  entry: ContractRecord,
  selection: Iss002StableVectorSelection,
): boolean {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  )
    return false;
  const record = input as Readonly<Record<string, unknown>>;
  if (Object.keys(record).sort().join("\0") !== "caseId\0samples\0seed") return false;
  const parameters = entry.generatorParameters as Readonly<Record<string, unknown>>;
  const expectedCount = Number(parameters.iterationCount);
  return (
    record.caseId === selection.fixtureId &&
    record.seed === parameters.seed &&
    Array.isArray(record.samples) &&
    Object.getPrototypeOf(record.samples) === Array.prototype &&
    record.samples.length === expectedCount &&
    record.samples.every((sample) => typeof sample === "string" && /^[0-9a-f]{16}$/.test(sample))
  );
}

export async function runIss002StableHandler(
  vectorCensusInput: unknown,
  dependencies: Iss002StableHandlerDependencies,
): Promise<Iss002StableHandlerResult> {
  try {
    const census = parseConformanceVectorCensus(vectorCensusInput);
    if (!census.ok) return refusal(...census.issues.map((issue) => `census.${issue}`));
    const entries = census.value.entries as readonly ContractRecord[];
    if (
      entries.length !== iss002StableVectorSelections.length ||
      entries.some(
        (entry, index) =>
          entry.fixtureId !== iss002StableVectorSelections[index]!.fixtureId ||
          entry.fixtureKind !== "GENERATOR",
      )
    )
      return refusal("handler:vector-census-mismatch");
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const vectorExecutions: Array<
      Readonly<{
        fixtureId: Iss002VectorId;
        normalizedResult: "FAIL" | "PASS" | "UNSUPPORTED";
      }>
    > = [];
    let walkDurationsNanoseconds: readonly string[] | null = null;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!;
      const selection = iss002StableVectorSelections[index]!;
      const generated = dependencies.generate(entry.generatorParameters);
      if (!validGeneratedFixture(generated, entry, selection))
        return refusal(`handler.${selection.fixtureId}:generated-fixture-refused`);
      const isWalk = selection.fixtureId === "walk-1000-records";
      const execution = isWalk
        ? await dependencies.executeWalk(selection, generated)
        : await dependencies.executeContracts(selection, generated);
      if (!validExecution(execution, isWalk))
        return refusal(`handler.${selection.fixtureId}:execution-refused`);
      stdout.push(Uint8Array.from(execution.stdoutBytes));
      stderr.push(Uint8Array.from(execution.stderrBytes));
      vectorExecutions.push(
        Object.freeze({
          fixtureId: selection.fixtureId,
          normalizedResult: execution.normalizedResult,
        }),
      );
      if (isWalk) walkDurationsNanoseconds = execution.walkDurationsNanoseconds;
    }
    return Object.freeze({
      ok: true as const,
      stderrBytes: Uint8Array.from(Buffer.concat(stderr.map((value) => Buffer.from(value)))),
      stdoutBytes: Uint8Array.from(Buffer.concat(stdout.map((value) => Buffer.from(value)))),
      vectorExecutions: Object.freeze(vectorExecutions),
      walkDurationsNanoseconds,
    });
  } catch {
    return refusal("handler:execution-failed");
  }
}

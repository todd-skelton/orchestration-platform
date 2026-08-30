import { types as nodeTypes } from "node:util";
import {
  frame,
  framedDigest,
  snapshotClosedRecord,
  type ContractRecord,
  type ParseResult,
} from "@orchestration-platform/contracts";
import {
  computePortableCustodyProfileDigest,
  computePortablePrimitiveObservationDigest,
  computePortablePrimitiveVectorDigest,
  parsePortablePrimitiveObservation,
  portablePrimitiveCaseIds,
  portablePrimitiveVectors,
} from "@orchestration-platform/portable-primitives";
import {
  computeConformanceRecordDigest,
  parseConformanceAggregate,
  parseConformanceBundleManifest,
  parseConformanceContractVersions,
} from "./contracts.js";
import { computeGithubProviderRunDigest, parseGithubProviderRunContext } from "./github-actions.js";
import {
  computeGithubConformanceDiagnosticTerminalDigest,
  parseGithubConformanceDiagnosticTerminal,
} from "./github-terminal.js";
import {
  computePortablePrimitivesDecisionWriterDigest,
  computePortablePrimitivesStableHarnessSubjectDigest,
  joinPortablePrimitivesDecisionCoreObservations,
  parsePortablePrimitivesCapabilityDecisionCore,
  portablePrimitivesCapabilityProfile,
  serializePortablePrimitivesCapabilityDecisionCore,
} from "./portable-primitives-decision.js";
import {
  parseCanonicalIss022StableRawReportBytes,
  parseIss022RequiredJobRegistry,
} from "./iss022-suite.js";

const evidenceFields = Object.freeze([
  "environment",
  "jobId",
  "rawArtifactManifest",
  "rawArtifacts",
] as const);
const rawFields = Object.freeze(["environment", "report", "stderr", "stdout"] as const);

export interface PortablePrimitivesDecisionCoreEvidence {
  readonly aggregate: unknown | null;
  readonly contractVersions: unknown;
  readonly diagnosticContractVersionsDigest: unknown | null;
  readonly diagnosticTerminal: unknown | null;
  readonly evidence: readonly unknown[];
  readonly harnessManifest: unknown;
  readonly providerRun: unknown;
  readonly registry: unknown;
  readonly testBundleManifest: unknown;
}

export type PortablePrimitivesDecisionCoreCompositionResult =
  | {
      readonly bytes: Uint8Array;
      readonly core: ContractRecord;
      readonly digest: string;
      readonly ok: true;
      readonly observations: readonly ContractRecord[];
    }
  | { readonly ok: false; readonly issues: readonly string[] };

function failure(...issues: readonly string[]): {
  readonly ok: false;
  readonly issues: readonly string[];
} {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function exactBytes(input: unknown): input is Uint8Array {
  return input instanceof Uint8Array && Object.getPrototypeOf(input) === Uint8Array.prototype;
}

function exactRecord(
  input: unknown,
  fields: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join("\0") !== [...fields].sort().join("\0")
  )
    return undefined;
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
  }
  return input as Readonly<Record<string, unknown>>;
}

function nullProfile(): ContractRecord {
  return Object.freeze(
    Object.fromEntries(
      Object.keys(portablePrimitivesCapabilityProfile).map((field) => [field, null]),
    ),
  ) as ContractRecord;
}

function evidenceRows(
  input: readonly unknown[],
  jobs: readonly ContractRecord[],
  providerRunDigest: string,
):
  | {
      readonly helperAbiDigests: readonly (string | null)[];
      readonly helperDigests: readonly (string | null)[];
      readonly observations: readonly ContractRecord[];
      readonly osProfileDigests: readonly (string | null)[];
    }
  | { readonly issues: readonly string[] } {
  const byJob = new Map<string, unknown>();
  for (const rowInput of input) {
    const row = exactRecord(rowInput, evidenceFields);
    if (!row || typeof row.jobId !== "string" || byJob.has(row.jobId))
      return { issues: ["evidence:closed-unique-job-rows-required"] };
    byJob.set(row.jobId, row);
  }
  const observations: ContractRecord[] = [];
  const helperAbiDigests: Array<string | null> = [];
  const helperDigests: Array<string | null> = [];
  const osProfileDigests: Array<string | null> = [];
  for (const job of jobs) {
    const jobId = String(job.jobId);
    const inputRow = byJob.get(jobId);
    if (!inputRow) {
      helperAbiDigests.push(null);
      helperDigests.push(null);
      osProfileDigests.push(null);
      continue;
    }
    const row = inputRow as ContractRecord;
    const raw = exactRecord(row.rawArtifacts, rawFields);
    if (!raw || rawFields.some((field) => !exactBytes(raw[field])))
      return { issues: [`evidence.${jobId}:raw-census-refused`] };
    const report = parseCanonicalIss022StableRawReportBytes(
      raw.report,
      row.environment,
      providerRunDigest,
      jobId,
    );
    if (!report.ok) return { issues: report.issues.map((issue) => `evidence.${jobId}.${issue}`) };
    const manifestDigest = computeConformanceRecordDigest(
      "conformance-raw-artifact-manifest/v1",
      row.rawArtifactManifest,
    );
    helperAbiDigests.push(String(report.report.helperAbiDigest));
    helperDigests.push(String(report.report.helperDigest));
    osProfileDigests.push(
      report.report.selection === null
        ? null
        : String((report.report.selection as ContractRecord).osProfileDigest),
    );
    const operatingSystem = String(report.environment.operatingSystem);
    const executions = report.report.vectorExecutions as readonly ContractRecord[];
    for (let index = 0; index < portablePrimitiveCaseIds.length; index += 1) {
      const execution = executions[index]!;
      const caseId = portablePrimitiveCaseIds[index]!;
      const observation = Object.freeze({
        caseId,
        detailsDigest: framedDigest("portable-primitives-observation-details/v1", [
          frame.raw32(manifestDigest),
          frame.text(caseId),
        ]),
        environmentDigest: report.environmentDigest,
        normalizedResult: execution.normalizedResult,
        observedAt: report.report.observedAt,
        operatingSystem,
        schemaVersion: "portable-primitives-observation/v1",
        vectorDigest: computePortablePrimitiveVectorDigest(portablePrimitiveVectors[index]),
      }) as ContractRecord;
      const parsedObservation = parsePortablePrimitiveObservation(observation);
      if (!parsedObservation.ok)
        return {
          issues: parsedObservation.issues.map(
            (issue) => `evidence.${jobId}.observation.${caseId}.${issue}`,
          ),
        };
      observations.push(parsedObservation.value);
    }
  }
  const expectedJobIds = new Set(jobs.map((job) => String(job.jobId)));
  if (
    byJob.size !== input.length ||
    byJob.size > jobs.length ||
    [...byJob.keys()].some((jobId) => !expectedJobIds.has(jobId))
  )
    return { issues: ["evidence:unexpected-job-row"] };
  return {
    helperAbiDigests: Object.freeze(helperAbiDigests),
    helperDigests: Object.freeze(helperDigests),
    observations: Object.freeze(observations),
    osProfileDigests: Object.freeze(osProfileDigests),
  };
}

export function composePortablePrimitivesDecisionCore(
  input: PortablePrimitivesDecisionCoreEvidence,
): PortablePrimitivesDecisionCoreCompositionResult {
  try {
    const providerRun = parseGithubProviderRunContext(input.providerRun);
    const registry = parseIss022RequiredJobRegistry(input.registry);
    const contracts = parseConformanceContractVersions(input.contractVersions);
    const harness = parseConformanceBundleManifest(input.harnessManifest);
    const tests = parseConformanceBundleManifest(input.testBundleManifest);
    if (!providerRun.ok)
      return failure(...providerRun.issues.map((issue) => `providerRun.${issue}`));
    if (!registry.ok) return failure(...registry.issues.map((issue) => `registry.${issue}`));
    if (!contracts.ok) return failure(...contracts.issues.map((issue) => `contracts.${issue}`));
    if (!harness.ok || harness.value.purpose !== "HARNESS") return failure("harness:refused");
    if (!tests.ok || tests.value.purpose !== "TEST_BUNDLE") return failure("tests:refused");
    const aggregate = input.aggregate === null ? null : parseConformanceAggregate(input.aggregate);
    const terminal =
      input.diagnosticTerminal === null
        ? null
        : parseGithubConformanceDiagnosticTerminal(input.diagnosticTerminal);
    if ((aggregate === null) === (terminal === null))
      return failure("decision:terminal-arm-refused");
    if (aggregate && !aggregate.ok)
      return failure(...aggregate.issues.map((issue) => `aggregate.${issue}`));
    if (terminal && !terminal.ok)
      return failure(...terminal.issues.map((issue) => `diagnosticTerminal.${issue}`));
    const providerRunDigest = computeGithubProviderRunDigest(providerRun.value);
    const contractVersionsDigest = computeConformanceRecordDigest(
      "conformance-contract-versions/v1",
      contracts.value,
    );
    if (
      (terminal === null && input.diagnosticContractVersionsDigest !== null) ||
      (terminal !== null && input.diagnosticContractVersionsDigest !== contractVersionsDigest)
    )
      return failure("contractVersionsDigest:terminal-arm-mismatch");
    const harnessBundleDigest = computeConformanceRecordDigest(
      "conformance-bundle-manifest/v1",
      harness.value,
    );
    const testBundleDigest = computeConformanceRecordDigest(
      "conformance-bundle-manifest/v1",
      tests.value,
    );
    const requiredJobRegistryDigest = computeConformanceRecordDigest(
      "conformance-required-job-registry/v1",
      registry.value,
    );
    for (const [field, actual] of [
      ["harnessBundleDigest", harnessBundleDigest],
      ["requiredJobRegistryDigest", requiredJobRegistryDigest],
      ["testBundleDigest", testBundleDigest],
    ] as const)
      if (providerRun.value[field] !== actual) return failure(`${field}:provider-run-mismatch`);
    if (aggregate?.ok) {
      for (const [field, actual] of [
        ["candidateSubjectDigest", providerRun.value.candidateSubjectDigest],
        ["contractVersionsDigest", contractVersionsDigest],
        ["harnessBundleDigest", harnessBundleDigest],
        ["providerRunDigest", providerRunDigest],
        ["requiredJobRegistryDigest", requiredJobRegistryDigest],
        ["testBundleDigest", testBundleDigest],
      ] as const)
        if (aggregate.value[field] !== actual) return failure(`aggregate.${field}:mismatch`);
    }
    if (terminal?.ok && terminal.value.providerRunDigest !== providerRunDigest)
      return failure("diagnosticTerminal.providerRunDigest:mismatch");
    const jobs = registry.value.jobs as readonly ContractRecord[];
    const rows = evidenceRows(input.evidence, jobs, providerRunDigest);
    if ("issues" in rows) return failure(...rows.issues);
    const pass = aggregate?.ok === true;
    const stableHarnessSubjectDigest = computePortablePrimitivesStableHarnessSubjectDigest(
      harnessBundleDigest,
      testBundleDigest,
      requiredJobRegistryDigest,
      contractVersionsDigest,
    );
    const core = Object.freeze({
      aggregateDigest: pass
        ? computeConformanceRecordDigest("conformance-aggregate/v1", aggregate.value)
        : null,
      candidateSubjectDigest: providerRun.value.candidateSubjectDigest,
      contractVersionsDigest,
      custodyProfileDigest: computePortableCustodyProfileDigest(),
      decision: pass ? "PASS" : "BLOCK_REPLAN",
      decisionWriterDigest: computePortablePrimitivesDecisionWriterDigest(
        stableHarnessSubjectDigest,
        harnessBundleDigest,
        testBundleDigest,
        contractVersionsDigest,
      ),
      diagnosticTerminalDigest: pass
        ? null
        : computeGithubConformanceDiagnosticTerminalDigest(terminal!.value),
      harnessBundleDigest,
      helperAbiDigests: rows.helperAbiDigests,
      helperDigests: rows.helperDigests,
      observationDigests: Object.freeze(
        rows.observations.map((observation) =>
          computePortablePrimitiveObservationDigest(observation),
        ),
      ),
      osProfileDigests: pass ? rows.osProfileDigests : Object.freeze([null, null, null]),
      profile: pass ? portablePrimitivesCapabilityProfile : nullProfile(),
      providerRunDigest,
      requiredJobRegistryDigest,
      schemaVersion: "portable-primitives-capability-decision-core/v1",
      stableHarnessSubjectDigest,
      testBundleDigest,
    }) as ContractRecord;
    const parsedCore = parsePortablePrimitivesCapabilityDecisionCore(core);
    if (!parsedCore.ok) return failure(...parsedCore.issues.map((issue) => `core.${issue}`));
    const joined = joinPortablePrimitivesDecisionCoreObservations(
      parsedCore.value,
      rows.observations,
    );
    if (!joined.ok) return failure(...joined.issues.map((issue) => `core.${issue}`));
    const serialized = serializePortablePrimitivesCapabilityDecisionCore(joined.value);
    if (!serialized.ok) return failure(...serialized.issues);
    return {
      bytes: serialized.bytes,
      core: joined.value,
      digest: serialized.digest,
      observations: rows.observations,
      ok: true,
    };
  } catch {
    return failure("decisionCoreComposition:unreadable");
  }
}

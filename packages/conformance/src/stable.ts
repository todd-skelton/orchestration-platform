import { createHash } from "node:crypto";
import type { ContractRecord } from "@orchestration-platform/contracts";
import {
  computeConformanceRecordDigest,
  computeConformanceVectorGeneratorDigest,
  parseConformanceContractVersions,
  parseConformanceRequiredJobRegistry,
  parseConformanceVectorCensus,
} from "./contracts.js";

export const iss002VectorIds = Object.freeze([
  "authority-history-linear",
  "authority-rotation-resting-cas-armed",
  "bootstrap-e0-core-post",
  "canonical-decimal-boundaries",
  "canonical-framing-boundaries",
  "commit-run-single-epoch-prefixes",
  "destination-owner-race",
  "external-ledger-literals",
  "full-required-loss",
  "physical-destination-profile",
  "pointer-digest-domains",
  "pointer-kind-census",
  "pointer-packet-purpose-handle",
  "recovery-archives-tombstones",
  "recovery-attempt-descriptor",
  "recovery-attempt-log",
  "recovery-attempt-reservation",
  "recovery-authorization-core",
  "reflective-arrays",
  "reflective-records",
  "run-current-crash-prefixes",
  "walk-1000-records",
] as const);

export type Iss002VectorId = (typeof iss002VectorIds)[number];

const censusVectors = new Set<Iss002VectorId>([
  "bootstrap-e0-core-post",
  "commit-run-single-epoch-prefixes",
  "external-ledger-literals",
  "pointer-digest-domains",
  "pointer-kind-census",
  "pointer-packet-purpose-handle",
  "recovery-archives-tombstones",
  "run-current-crash-prefixes",
]);
const refusalVectors = new Set<Iss002VectorId>([
  "full-required-loss",
  "reflective-arrays",
  "reflective-records",
]);

function vectorSeed(vectorId: Iss002VectorId): string {
  return createHash("sha256")
    .update("orchestration-platform/iss002-vector-seed/v1\0", "utf8")
    .update(vectorId, "utf8")
    .digest("hex");
}

function expectedDisposition(vectorId: Iss002VectorId): "ACCEPT" | "REFUSE" | "CENSUS" | "MEASURE" {
  if (vectorId === "walk-1000-records") return "MEASURE";
  if (refusalVectors.has(vectorId)) return "REFUSE";
  if (censusVectors.has(vectorId)) return "CENSUS";
  return "ACCEPT";
}

export function createIss002VectorCensus(generatorSourceBytes: Uint8Array): ContractRecord {
  const entries = iss002VectorIds.map((fixtureId) => {
    const generatorParameters = Object.freeze({
      caseId: fixtureId,
      iterationCount: fixtureId === "walk-1000-records" ? "1000" : "1",
      seed: vectorSeed(fixtureId),
    });
    return Object.freeze({
      expectedDisposition: expectedDisposition(fixtureId),
      fixtureDigest: computeConformanceVectorGeneratorDigest(
        generatorSourceBytes,
        generatorParameters,
      ),
      fixtureId,
      fixtureKind: "GENERATOR",
      generatorParameters,
    });
  });
  const census = Object.freeze({
    entries: Object.freeze(entries),
    schemaVersion: "conformance-vector-census/v1",
  });
  const parsed = parseConformanceVectorCensus(census);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return parsed.value;
}

export function createIss002ContractVersions(versions: readonly string[]): ContractRecord {
  const census = Object.freeze({
    schemaVersion: "conformance-contract-versions/v1",
    versions: Object.freeze([...versions]),
  });
  const parsed = parseConformanceContractVersions(census);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return parsed.value;
}

export function createIss002RequiredJobRegistry(vectorCensus: unknown): ContractRecord {
  const vectorDigest = computeConformanceRecordDigest("conformance-vector-census/v1", vectorCensus);
  const registry = Object.freeze({
    jobs: Object.freeze(
      ["linux", "macos", "windows"].map((environment) =>
        Object.freeze({
          environmentFamily: environment.toUpperCase(),
          jobId: `iss002-contracts-${environment}`,
          requirement: "REQUIRED",
          suiteId: "iss002-contracts",
        }),
      ),
    ),
    schemaVersion: "conformance-required-job-registry/v1",
    suites: Object.freeze([
      Object.freeze({
        custodyRequirement: "UNUSED",
        helperRequirement: "UNUSED",
        ownerPackage: "@orchestration-platform/contracts",
        runnerToken: "ISS002_CONTRACTS",
        suiteId: "iss002-contracts",
        vectorCensusDigest: vectorDigest,
        walkRequirement: "WALK_1000",
      }),
    ]),
  });
  const parsed = parseConformanceRequiredJobRegistry(registry);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return parsed.value;
}

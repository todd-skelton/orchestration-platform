import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTrackedText } from "../../scripts/tracked-text.mjs";
import { extractSourceEvidence, parseLiveArguments } from "./source-evidence.mjs";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestNames = Object.freeze([
  "source",
  "artifacts",
  "behaviors",
  "entrypoints",
  "mutations",
  "authorities",
  "transitions",
  "assumptions",
  "redaction-oracle",
]);
const classifications = new Set([
  "platform-mechanism",
  "adapter-policy",
  "historical-compatibility",
  "obsolete",
]);
const hex40 = /^[a-f0-9]{40}$/;
const hex64 = /^[a-f0-9]{64}$/;

function fail(message) {
  throw new Error(`REFERENCE_INVENTORY_MISMATCH: ${message}`);
}

function digest(domain, ...parts) {
  const hash = createHash("sha256").update(`${domain}\0`);
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
}

function aggregateRows(domain, rows) {
  return digest(domain, ...rows.map((row) => JSON.stringify(row)));
}

function unique(rows, select, label) {
  const seen = new Set();
  for (const row of rows) {
    const value = select(row);
    if (!value || seen.has(value)) fail(`${label} contains a missing or duplicate identity`);
    seen.add(value);
  }
  return seen;
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function artifactEvidence(row) {
  return {
    pathDigest: row.pathDigest,
    objectId: row.objectId,
    contentDigest: row.contentDigest,
    byteLength: row.byteLength,
    mode: row.mode,
    type: row.type,
    extension: row.extension,
    artifactId: row.artifactId,
  };
}

function validateSource(snapshot) {
  const { source, artifacts, entrypoints, mutations } = snapshot;
  if (source.schemaVersion !== "reference-source-census/v1") fail("source schema mismatch");
  const binding = source.source;
  if (
    !hex40.test(binding.commit) ||
    !hex40.test(binding.treeObject) ||
    !hex64.test(binding.artifactRoot) ||
    !hex64.test(binding.entrypointRoot) ||
    !hex64.test(binding.effectCandidateRoot)
  ) {
    fail("source binding is malformed");
  }
  if (binding.artifactCount !== 112 || artifacts.artifacts.length !== binding.artifactCount) {
    fail("artifact count mismatch");
  }
  if (artifacts.schemaVersion !== "reference-artifact-inventory/v1") {
    fail("artifact schema mismatch");
  }
  const expectedIds = artifacts.artifacts.map(
    (_, index) => `artifact-${String(index + 1).padStart(3, "0")}`,
  );
  if (
    !same(
      artifacts.artifacts.map(({ artifactId }) => artifactId),
      expectedIds,
    )
  ) {
    fail("artifact identities are not complete and ordered");
  }
  unique(artifacts.artifacts, ({ pathDigest }) => pathDigest, "artifact path digest census");
  unique(artifacts.artifacts, ({ artifactId }) => artifactId, "artifact identity census");
  for (const row of artifacts.artifacts) {
    if (
      !hex64.test(row.pathDigest) ||
      !hex40.test(row.objectId) ||
      !hex64.test(row.contentDigest) ||
      !Number.isSafeInteger(row.byteLength) ||
      row.byteLength < 0 ||
      row.mode !== "100644" ||
      row.type !== "blob" ||
      !/^[a-z0-9]+$/.test(row.extension) ||
      !classifications.has(row.classification) ||
      !Array.isArray(row.behaviorFamilyIds) ||
      row.behaviorFamilyIds.length === 0 ||
      !["characterize", "obsolete"].includes(row.disposition)
    ) {
      fail(`artifact row ${row.artifactId} is malformed or unclassified`);
    }
    if (row.classification === "obsolete" && row.disposition !== "obsolete") {
      fail(`obsolete artifact ${row.artifactId} lacks an obsolete disposition`);
    }
  }
  const artifactRows = artifacts.artifacts.map(artifactEvidence);
  if (aggregateRows("reference-artifact-root/v1", artifactRows) !== binding.artifactRoot) {
    fail("artifact aggregate root mismatch");
  }
  const extensionCensus = Object.fromEntries(
    [...new Set(artifactRows.map(({ extension }) => extension))]
      .sort()
      .map((extension) => [
        extension,
        artifactRows.filter((row) => row.extension === extension).length,
      ]),
  );
  if (!same(extensionCensus, source.extensionCensus)) fail("extension census mismatch");
  if (
    entrypoints.schemaVersion !== "reference-entrypoint-census/v1" ||
    entrypoints.entrypointCount !== binding.entrypointCount ||
    entrypoints.entrypointRoot !== binding.entrypointRoot
  ) {
    fail("entrypoint binding mismatch");
  }
  const executable = new Set(["ps1", "cjs", "sh", "vbs"]);
  const expectedEntrypoints = artifactRows
    .filter(({ extension }) => executable.has(extension))
    .map(({ artifactId, pathDigest, extension: kind }) => ({ artifactId, pathDigest, kind }));
  const observedEntrypoints = entrypoints.entrypoints.map(({ artifactId, pathDigest, kind }) => ({
    artifactId,
    pathDigest,
    kind,
  }));
  if (!same(observedEntrypoints, expectedEntrypoints)) fail("entrypoint census mismatch");
  if (
    aggregateRows("reference-entrypoint-root/v1", observedEntrypoints) !== binding.entrypointRoot
  ) {
    fail("entrypoint aggregate root mismatch");
  }
  if (
    mutations.schemaVersion !== "reference-mutation-census/v1" ||
    mutations.candidateCount !== binding.effectCandidateCount ||
    mutations.candidateRoot !== binding.effectCandidateRoot
  ) {
    fail("mutation candidate binding mismatch");
  }
  const candidateCensus = Object.fromEntries(
    mutations.mutationGroups.map(({ candidateKind, callsiteCount }) => [
      candidateKind,
      callsiteCount,
    ]),
  );
  if (!same(candidateCensus, source.effectCandidateCensus)) {
    fail("mutation candidate census mismatch");
  }
  if (
    mutations.mutationGroups.reduce((total, row) => total + row.callsiteCount, 0) !==
    binding.effectCandidateCount
  ) {
    fail("mutation candidate groups omit or duplicate callsites");
  }
}

function validateReferences(snapshot) {
  const { artifacts, behaviors, entrypoints, mutations, authorities, transitions, assumptions } =
    snapshot;
  if (behaviors.schemaVersion !== "reference-behavior-families/v1")
    fail("behavior schema mismatch");
  const behaviorIds = unique(behaviors.families, ({ id }) => id, "behavior family census");
  for (const family of behaviors.families) {
    if (!classifications.has(family.classification) || family.capabilities.length === 0) {
      fail(`behavior family ${family.id} is unclassified`);
    }
  }
  for (const artifact of artifacts.artifacts) {
    if (artifact.behaviorFamilyIds.some((id) => !behaviorIds.has(id))) {
      fail(`artifact ${artifact.artifactId} has a dangling behavior family`);
    }
  }
  const artifactsById = new Map(artifacts.artifacts.map((row) => [row.artifactId, row]));
  unique(entrypoints.entrypoints, ({ entrypointId }) => entrypointId, "entrypoint identity census");
  for (const row of entrypoints.entrypoints) {
    const artifact = artifactsById.get(row.artifactId);
    if (
      !artifact ||
      artifact.pathDigest !== row.pathDigest ||
      !classifications.has(row.classification) ||
      row.behaviorFamilyIds.some((id) => !behaviorIds.has(id)) ||
      row.argumentPolicy !== "explicit-only"
    ) {
      fail(`entrypoint ${row.entrypointId} is unclassified or dangling`);
    }
  }
  if (authorities.schemaVersion !== "reference-authority-inventory/v1") {
    fail("authority schema mismatch");
  }
  const authorityIds = unique(authorities.authorities, ({ id }) => id, "authority census");
  const observationIds = unique(authorities.observations, ({ id }) => id, "observation census");
  for (const row of authorities.authorities) {
    if (!observationIds.has(row.requiredObservation)) fail(`authority ${row.id} is unobserved`);
  }
  if (transitions.schemaVersion !== "reference-recovery-transitions/v1") {
    fail("transition schema mismatch");
  }
  const transitionIds = unique(transitions.transitions, ({ id }) => id, "transition census");
  unique(
    mutations.mutationGroups,
    ({ mutationGroupId }) => mutationGroupId,
    "mutation group census",
  );
  unique(mutations.mutationGroups, ({ candidateKind }) => candidateKind, "mutation kind census");
  for (const row of mutations.mutationGroups) {
    if (
      !Number.isSafeInteger(row.callsiteCount) ||
      row.callsiteCount < 1 ||
      !hex64.test(row.callsiteRoot) ||
      !authorityIds.has(row.authorityId) ||
      !observationIds.has(row.authorizingObservationId) ||
      !Array.isArray(row.failureModes) ||
      row.failureModes.length === 0 ||
      !transitionIds.has(row.recoveryTransitionId) ||
      !row.idempotency ||
      !classifications.has(row.classification)
    ) {
      fail(`mutation group ${row.mutationGroupId} lacks authority, failure, or recovery evidence`);
    }
  }
  if (assumptions.schemaVersion !== "reference-assumption-inventory/v1") {
    fail("assumption schema mismatch");
  }
  unique(assumptions.assumptions, ({ id }) => id, "assumption census");
  for (const row of assumptions.assumptions) {
    if (!classifications.has(row.classification) || !behaviorIds.has(row.behaviorFamilyId)) {
      fail(`assumption ${row.id} is unclassified or dangling`);
    }
    if (row.disposition === "linked-probe" || row.disposition === "linked-decision") {
      if (
        !row.resolution ||
        !["probe", "decision"].includes(row.resolution.kind) ||
        !/^ISS-\d{3}$/.test(row.resolution.issue)
      ) {
        fail(`assumption ${row.id} lacks a linked resolution`);
      }
    }
  }
  if (/\bunknown\b/i.test(JSON.stringify(snapshot))) fail("inventory contains an unlinked unknown");
}

function validateOracle(snapshot) {
  const oracle = snapshot["redaction-oracle"];
  if (oracle.schemaVersion !== "reference-forbidden-vocabulary/v1") {
    fail("redaction oracle schema mismatch");
  }
  unique(oracle.entries, ({ digest: value }) => value, "redaction digest census");
  for (const row of oracle.entries) {
    if (!hex64.test(row.digest) || !row.neutralCapability || !row.matchPolicy) {
      fail("redaction oracle contains a raw or malformed row");
    }
  }
}

export async function loadInventory(root = defaultRoot) {
  const result = {};
  for (const name of manifestNames) {
    const source = await readFile(resolve(root, "reference/manifest", `${name}.json`), "utf8");
    try {
      normalizeTrackedText(source);
    } catch {
      fail(`manifest ${name} has malformed line endings`);
    }
    const parsed = JSON.parse(source);
    result[name] = parsed;
  }
  return result;
}

export function validateInventory(snapshot) {
  validateSource(snapshot);
  validateReferences(snapshot);
  validateOracle(snapshot);
  return {
    artifactCount: snapshot.source.source.artifactCount,
    entrypointCount: snapshot.source.source.entrypointCount,
    effectCandidateCount: snapshot.source.source.effectCandidateCount,
    unresolved: snapshot.assumptions.assumptions.filter((row) => row.resolution).length,
  };
}

export async function compareLiveSource(snapshot, options) {
  const evidence = await extractSourceEvidence(options);
  const binding = snapshot.source.source;
  if (
    evidence.commit !== binding.commit ||
    evidence.treeObject !== binding.treeObject ||
    evidence.artifactCount !== binding.artifactCount ||
    evidence.artifactRoot !== binding.artifactRoot ||
    evidence.entrypointCount !== binding.entrypointCount ||
    evidence.entrypointRoot !== binding.entrypointRoot ||
    evidence.effectCandidateCount !== binding.effectCandidateCount ||
    evidence.effectCandidateRoot !== binding.effectCandidateRoot ||
    !same(evidence.extensionCensus, snapshot.source.extensionCensus) ||
    !same(evidence.candidateCensus, snapshot.source.effectCandidateCensus)
  ) {
    fail("live source binding or census differs from the sanitized inventory");
  }
  const observedArtifacts = snapshot.artifacts.artifacts.map(artifactEvidence);
  if (!same(evidence.artifacts, observedArtifacts)) fail("live artifact rows differ");
  const groups = new Map(snapshot.mutations.mutationGroups.map((row) => [row.candidateKind, row]));
  for (const [kind, observed] of Object.entries(evidence.candidateGroups)) {
    const expected = groups.get(kind);
    if (
      !expected ||
      expected.callsiteCount !== observed.count ||
      expected.callsiteRoot !== observed.root
    ) {
      fail(`live mutation candidate group differs for ${kind}`);
    }
  }
  return {
    artifactCount: evidence.artifactCount,
    artifactRoot: evidence.artifactRoot,
    entrypointCount: evidence.entrypointCount,
    effectCandidateCount: evidence.effectCandidateCount,
    effectCandidateRoot: evidence.effectCandidateRoot,
  };
}

export async function runInventoryCli(argv, root = defaultRoot) {
  const live = parseLiveArguments(argv);
  const snapshot = await loadInventory(root);
  const summary = validateInventory(snapshot);
  const liveSummary = live ? await compareLiveSource(snapshot, live) : undefined;
  process.stdout.write(
    `${JSON.stringify({ schemaVersion: "reference-inventory-check/v1", outcome: "success", ...summary, live: liveSummary })}\n`,
  );
}

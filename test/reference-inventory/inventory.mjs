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
const classificationValues = Object.freeze([
  "adapter-policy",
  "historical-compatibility",
  "obsolete",
  "platform-mechanism",
]);
const classifications = new Set(classificationValues);
const resolutionIssues = Object.freeze(
  new Map([
    ["assumption-unresolved-parser-equivalence", { kind: "probe", issue: "ISS-022" }],
    ["assumption-unresolved-host-tool-surface", { kind: "probe", issue: "ISS-023" }],
  ]),
);
const signalTargets = Object.freeze(
  new Map([
    ["dynamic-invocation", "process"],
    ["fixture-local-write", "filesystem"],
    ["member-mutation", "filesystem"],
    ["process-lifecycle", "process"],
    ["provider-control-plane", "external-provider"],
    ["stream-redirection", "filesystem"],
    ["version-control", "repository"],
  ]),
);
const classSlugs = Object.freeze(
  new Map([
    ["adapter-policy", "adapter"],
    ["historical-compatibility", "compatibility"],
    ["platform-mechanism", "platform"],
  ]),
);
const mutationContracts = Object.freeze(
  new Map([
    [
      "platform-mechanism|filesystem",
      {
        authorityId: "authority-filesystem",
        authorizingObservationId: "observation-path-confinement",
        failureModes: ["destination-moved", "partial-write"],
        recoveryTransitionId: "transition-reconcile-filesystem",
        idempotency: "receipt-before-retry",
      },
    ],
    [
      "adapter-policy|filesystem",
      {
        authorityId: "authority-filesystem",
        authorizingObservationId: "observation-path-confinement",
        failureModes: ["destination-moved", "partial-write"],
        recoveryTransitionId: "transition-reconcile-filesystem",
        idempotency: "receipt-before-retry",
      },
    ],
    [
      "platform-mechanism|process",
      {
        authorityId: "authority-process-table",
        authorizingObservationId: "observation-exact-process-identity",
        failureModes: ["owner-moved", "partial-launch", "target-unresolved"],
        recoveryTransitionId: "transition-terminate-exact-owner",
        idempotency: "exact-owner-once",
      },
    ],
    [
      "adapter-policy|process",
      {
        authorityId: "authority-process-table",
        authorizingObservationId: "observation-exact-process-identity",
        failureModes: ["owner-moved", "partial-launch", "target-unresolved"],
        recoveryTransitionId: "transition-terminate-exact-owner",
        idempotency: "exact-owner-once",
      },
    ],
    [
      "platform-mechanism|external-provider",
      {
        authorityId: "authority-external-provider",
        authorizingObservationId: "observation-fresh-external-subject",
        failureModes: ["external-unavailable", "partial-provider-acceptance", "subject-moved"],
        recoveryTransitionId: "transition-open-breaker",
        idempotency: "plan-id-and-fresh-subject",
      },
    ],
    [
      "platform-mechanism|repository",
      {
        authorityId: "authority-version-control",
        authorizingObservationId: "observation-exact-revision-and-cleanliness",
        failureModes: ["dirty-workspace", "partial-ref-update", "subject-moved"],
        recoveryTransitionId: "transition-replan-moved-revision",
        idempotency: "exact-revision-and-plan-id",
      },
    ],
    [
      "historical-compatibility|filesystem",
      {
        authorityId: "authority-test-fixture",
        authorizingObservationId: "observation-fixture-confinement",
        failureModes: ["fixture-escape", "partial-write"],
        recoveryTransitionId: "transition-remove-fixture",
        idempotency: "remove-then-recreate",
      },
    ],
    [
      "historical-compatibility|process",
      {
        authorityId: "authority-test-fixture",
        authorizingObservationId: "observation-fixture-confinement",
        failureModes: ["fixture-escape", "partial-launch"],
        recoveryTransitionId: "transition-remove-fixture",
        idempotency: "remove-then-recreate",
      },
    ],
    [
      "historical-compatibility|external-provider",
      {
        authorityId: "authority-test-fixture",
        authorizingObservationId: "observation-fixture-confinement",
        failureModes: ["fixture-escape", "synthetic-divergence"],
        recoveryTransitionId: "transition-remove-fixture",
        idempotency: "remove-then-recreate",
      },
    ],
    [
      "historical-compatibility|repository",
      {
        authorityId: "authority-test-fixture",
        authorizingObservationId: "observation-fixture-confinement",
        failureModes: ["fixture-escape", "partial-ref-update"],
        recoveryTransitionId: "transition-remove-fixture",
        idempotency: "remove-then-recreate",
      },
    ],
  ]),
);
const hex40 = /^[a-f0-9]{40}$/;
const hex64 = /^[a-f0-9]{64}$/;
const pinnedSource = Object.freeze({
  schemaVersion: "reference-source-census/v2",
  source: {
    commit: "216887080f0570edbbac1c4e3a74a17add242ce3",
    treeObject: "c9ca742a3248d5ea78a41b11956ac2a9ba4805f2",
    artifactCount: 112,
    artifactRoot: "fd456ea8dfb266007dd7e6851df54df8e29f1099c81cf9e5fde66a38c1132cfe",
    entrypointCount: 79,
    entrypointRoot: "62ab3dfacdc527459aaf77262959c2aa3adf20cb36a4d9f60ddb99c9a3f9eae3",
    effectCandidateCount: 887,
    effectCandidateRoot: "6fb36afcf05336b3a6c7dd0666c9e498139872d3a91340b66ecfba680c62ec04",
  },
  semanticRoots: {
    artifacts: "21b696f7b99f0bf75dbef540f87cd932adbc4d3ba3f14e3d87983cf561ad5ee5",
    assumptions: "da05fe041327366d34efa83c271a4be777cee472c0685375aa1200bab5d55876",
    authorities: "248d82572d5f582cfe2453a6c7d7335f761403e75a6c23a7fea8f6922a8acc7f",
    behaviors: "1276d2f5cb963ab948ddae20b9b422503bb95ad4f04654295bc6c893cde15eca",
    entrypoints: "33e8feee34b6d78246e46c0a6a391aad6ad449b47e563500a9742f165d6c1331",
    forbiddenVocabulary: "82e1b8c8bc4003c1e0db858098fbd8dc6cdaca5fc0076abc8cf203868d9fb7b7",
    mutations: "059160923c453eafcfca2226f6f623099ab85d714dd65f8f9688df73df8c7cd5",
    sourcePaths: "da092a7f8c24652b1db4e77b62b4ca4cba1b6cceb751d66a0924f4908194e536",
    transitions: "ad1f114e1c2c751fe38880a79e897f8dbce4b0c2c8a1bc97eb21157435815fad",
    pathSensitivity: "c3992bebb297085dda146efe839c54301a3f0f0e74025680d9b207db2c293f69",
    publicationFingerprints: "b9ae11a5d5a713c742971d86af9a642a3d59ff8a1881b151fb4c3e2ffa769701",
  },
  extensionCensus: {
    cjs: 2,
    fixture: 3,
    json: 14,
    md: 8,
    ps1: 75,
    psm1: 5,
    sh: 1,
    txt: 1,
    vbs: 1,
    yaml: 2,
  },
  effectCandidateCensus: {
    "dynamic-invocation": 279,
    "fixture-local-write": 443,
    "member-mutation": 39,
    "process-lifecycle": 23,
    "provider-control-plane": 34,
    "stream-redirection": 50,
    "version-control": 19,
  },
  pathDigest: "sha256(reference-artifact-path/v1 NUL subtree-relative-path-bytes NUL)",
  coverageRule:
    "All selected tree entries are regular blobs and occur exactly once in artifacts.json.",
});

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

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function canonicalTokens(value) {
  return (
    JSON.stringify(stableValue(value)).match(
      /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|true|false|null/gi,
    ) ?? []
  );
}

function typedValueSignature(value) {
  if (value === null) return JSON.stringify(["null"]);
  if (Array.isArray(value)) {
    return JSON.stringify(["array", value.map(typedValueSignature).sort()]);
  }
  if (typeof value === "object") {
    return JSON.stringify(["object", Object.values(value).map(typedValueSignature).sort()]);
  }
  return JSON.stringify([typeof value, value]);
}

function collectStrongScalars(value, result = []) {
  if (Array.isArray(value)) {
    for (const child of value) collectStrongScalars(child, result);
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectStrongScalars(child, result);
  } else if (typeof value === "string" && value.normalize("NFKC").length >= 12) {
    result.push(digest("reference-publication-strong-scalar/v1", typedValueSignature(value)));
  }
  return result;
}

function collectTypedScalars(value, result = []) {
  if (Array.isArray(value)) {
    for (const child of value) collectTypedScalars(child, result);
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectTypedScalars(child, result);
  } else {
    result.push(typedValueSignature(value));
  }
  return result;
}

export function publicationStreamFingerprints(values) {
  const signatures = collectTypedScalars(values).sort();
  const relationshipDigests = [];
  for (let left = 0; left < signatures.length; left += 1) {
    for (let right = left + 1; right < signatures.length; right += 1) {
      relationshipDigests.push(
        digest("reference-publication-stream-relationship/v1", signatures[left], signatures[right]),
      );
    }
  }
  return {
    scalarCount: signatures.length,
    streamRowDigest:
      signatures.length >= 2
        ? digest("reference-publication-stream-row/v1", ...signatures)
        : undefined,
    streamRelationshipDigests: sortedUnique(relationshipDigests),
    strongScalarDigests: sortedUnique(collectStrongScalars(values)),
  };
}

export function publicationValueFingerprints(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valueRowDigest: undefined, relationshipDigests: [], strongScalarDigests: [] };
  }
  const signatures = Object.values(value).map(typedValueSignature).sort();
  const relationshipDigests = [];
  for (let left = 0; left < signatures.length; left += 1) {
    for (let right = left + 1; right < signatures.length; right += 1) {
      relationshipDigests.push(
        digest("reference-publication-value-relationship/v1", signatures[left], signatures[right]),
      );
    }
  }
  return {
    valueRowDigest: digest("reference-publication-value-row/v1", ...signatures),
    relationshipDigests: sortedUnique(relationshipDigests),
    strongScalarDigests: sortedUnique(collectStrongScalars(value)),
  };
}

function publicationRows(snapshot) {
  const pathCensus = snapshot["redaction-oracle"].sourcePathCensus;
  return new Map([
    [
      "source",
      [
        snapshot.source.source,
        snapshot.source.extensionCensus,
        snapshot.source.effectCandidateCensus,
      ],
    ],
    ["artifacts", snapshot.artifacts.artifacts],
    ["behaviors", snapshot.behaviors.families],
    ["entrypoints", snapshot.entrypoints.entrypoints],
    ["mutations", [...snapshot.mutations.mutationGroups, ...snapshot.mutations.callsites]],
    ["authorities", [...snapshot.authorities.authorities, ...snapshot.authorities.observations]],
    ["transitions", snapshot.transitions.transitions],
    ["assumptions", snapshot.assumptions.assumptions],
    [
      "redaction-oracle",
      [
        ...snapshot["redaction-oracle"].entries,
        ...pathCensus.entries,
        pathCensus.sensitivity,
        snapshot["redaction-oracle"].copyPolicy,
      ],
    ],
  ]);
}

export function buildPublicationFingerprints(snapshot) {
  const families = [];
  const rowDigests = new Set();
  const chunkDigests = new Set();
  const valueRowDigests = new Set();
  const relationshipDigests = new Set();
  const strongScalarDigests = new Set();
  const streamRowDigests = new Set();
  const streamRelationshipDigests = new Set();
  const streamArities = new Set();
  for (const [familyId, rows] of publicationRows(snapshot)) {
    const familyRows = [];
    const familyChunks = [];
    const familyValueRows = [];
    const familyRelationships = [];
    const familyStrongScalars = [];
    const familyStreamRows = [];
    const familyStreamRelationships = [];
    for (const row of rows) {
      const canonical = JSON.stringify(stableValue(row));
      const rowDigest = digest("reference-publication-row/v1", canonical);
      familyRows.push(rowDigest);
      rowDigests.add(rowDigest);
      const tokens = canonicalTokens(row);
      for (let offset = 0; offset + 6 <= tokens.length; offset += 1) {
        const chunkDigest = digest(
          "reference-publication-chunk/v1",
          ...tokens.slice(offset, offset + 6),
        );
        familyChunks.push(chunkDigest);
        chunkDigests.add(chunkDigest);
      }
      const valueFingerprints = publicationValueFingerprints(row);
      familyValueRows.push(valueFingerprints.valueRowDigest);
      valueRowDigests.add(valueFingerprints.valueRowDigest);
      for (const relationshipDigest of valueFingerprints.relationshipDigests) {
        familyRelationships.push(relationshipDigest);
        relationshipDigests.add(relationshipDigest);
      }
      for (const scalarDigest of valueFingerprints.strongScalarDigests) {
        familyStrongScalars.push(scalarDigest);
        strongScalarDigests.add(scalarDigest);
      }
      const streamFingerprints = publicationStreamFingerprints(Object.values(row));
      streamArities.add(streamFingerprints.scalarCount);
      if (streamFingerprints.streamRowDigest) {
        familyStreamRows.push(streamFingerprints.streamRowDigest);
        streamRowDigests.add(streamFingerprints.streamRowDigest);
      }
      for (const relationshipDigest of streamFingerprints.streamRelationshipDigests) {
        familyStreamRelationships.push(relationshipDigest);
        streamRelationshipDigests.add(relationshipDigest);
      }
    }
    const uniqueRows = sortedUnique(familyRows);
    const uniqueChunks = sortedUnique(familyChunks);
    const uniqueValueRows = sortedUnique(familyValueRows);
    const uniqueRelationships = sortedUnique(familyRelationships);
    const uniqueStrongScalars = sortedUnique(familyStrongScalars);
    const uniqueStreamRows = sortedUnique(familyStreamRows);
    const uniqueStreamRelationships = sortedUnique(familyStreamRelationships);
    families.push({
      familyId,
      rowCount: uniqueRows.length,
      rowRoot: aggregateRows("reference-publication-row-root/v1", uniqueRows),
      chunkCount: uniqueChunks.length,
      chunkRoot: aggregateRows("reference-publication-chunk-root/v1", uniqueChunks),
      valueRowCount: uniqueValueRows.length,
      valueRowRoot: aggregateRows("reference-publication-value-row-root/v1", uniqueValueRows),
      relationshipCount: uniqueRelationships.length,
      relationshipRoot: aggregateRows(
        "reference-publication-value-relationship-root/v1",
        uniqueRelationships,
      ),
      strongScalarCount: uniqueStrongScalars.length,
      strongScalarRoot: aggregateRows(
        "reference-publication-strong-scalar-root/v1",
        uniqueStrongScalars,
      ),
      streamRowCount: uniqueStreamRows.length,
      streamRowRoot: aggregateRows("reference-publication-stream-row-root/v1", uniqueStreamRows),
      streamRelationshipCount: uniqueStreamRelationships.length,
      streamRelationshipRoot: aggregateRows(
        "reference-publication-stream-relationship-root/v1",
        uniqueStreamRelationships,
      ),
    });
  }
  const census = {
    schemaVersion: "reference-publication-fingerprints/v8",
    derivation:
      "Canonical rows/chunks, key-independent typed value rows, and flattened typed scalar streams with order-independent subset relationships across bounded arbitrary text; scalar syntax position does not grant exclusion, valid continuations are decoded, template static segments are combined with every independently decoded ordered quoted subsequence, and comment-separated adjacent literal concatenations are reconstructed without evaluation under pinned Cartesian bounds.",
    minimumFragmentPolicy: {
      directValueRelationshipArity: 2,
      streamRelationshipArity: 2,
      streamRowMinimumScalarCount: 2,
      maximumNeutralInterleavingScalars: 7,
      maximumDecodedScalarCharacters: 4096,
      maximumEncodedScalarCharacters: 32768,
      maximumScalarTokensPerScan: 65536,
      maximumTemplateCandidates: 256,
      maximumTemplateInterpolations: 16,
      maximumTemplateAlternativesPerInterpolation: 16,
      maximumAdjacentLiteralChainTokens: 16,
      maximumLiteralSeparatorCharacters: 4096,
      strongStringMinimumNormalizedCharacters: 12,
      propertyNameDisposition: "candidate-scalar",
      javascriptCodePointEscapeDisposition: "decode-without-evaluation",
      javascriptLineContinuationDisposition: "remove-lf-or-crlf",
      templateInterpolationDisposition:
        "bounded-cartesian-ordered-quoted-subsequences-with-omission-and-static-segments",
      adjacentLiteralConcatenationDisposition:
        "bounded-cartesian-reconstruction-across-plus-parenthesis-whitespace-and-lexed-comments",
      literalSeparatorCommentDisposition:
        "strip-bounded-block-or-line-comments-and-reject-unterminated-comments",
      templateFailureDisposition: "reject-malformed-or-bound-overflow",
      decodedScalarBoundaryDisposition: "4096-allowed-4097-rejected",
      overflowDisposition: "reject",
      publicationCollisionDisposition:
        "zero-collision-required-on-actual-packed-and-built-surfaces",
      belowMinimumDisposition: "not-identifying-without-an-independent-marker",
    },
    families,
  };
  census.fingerprintRoot = aggregateRows("reference-publication-fingerprint-root/v2", [
    {
      schemaVersion: census.schemaVersion,
      derivation: census.derivation,
      minimumFragmentPolicy: census.minimumFragmentPolicy,
      families,
    },
  ]);
  return {
    census,
    rowDigests,
    chunkDigests,
    valueRowDigests,
    relationshipDigests,
    strongScalarDigests,
    streamRowDigests,
    streamRelationshipDigests,
    streamArities: new Set([...streamArities].sort((left, right) => left - right)),
  };
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
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

function exactKeys(row, keys, label) {
  if (!row || !same(Object.keys(row).sort(), [...keys].sort())) fail(`${label} has an open shape`);
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

function artifactSemanticEvidence(row) {
  return {
    artifactId: row.artifactId,
    pathDigest: row.pathDigest,
    classification: row.classification,
    behaviorFamilyIds: row.behaviorFamilyIds,
    disposition: row.disposition,
    obsoleteEvidence: row.obsoleteEvidence ?? null,
  };
}

function entrypointEvidence(row) {
  return {
    entrypointId: row.entrypointId,
    artifactId: row.artifactId,
    pathDigest: row.pathDigest,
    kind: row.kind,
    classification: row.classification,
    behaviorFamilyIds: row.behaviorFamilyIds,
    argumentPolicy: row.argumentPolicy,
    authorityPolicy: row.authorityPolicy,
  };
}

function callsiteEvidence(row) {
  return {
    callsiteDigest: row.callsiteDigest,
    artifactId: row.artifactId,
    signalKind: row.signalKind,
    mutationClass: row.mutationClass,
    classification: row.classification,
    behaviorContextRoot: row.behaviorContextRoot,
    mutationGroupId: row.mutationGroupId,
  };
}

function expectedGroupId(classification, target) {
  const slug = classSlugs.get(classification);
  if (!slug) fail(`mutation classification ${classification} is not executable`);
  return `mutation-${slug}-${target}`;
}

function semanticCallsite(row, artifact) {
  const target = signalTargets.get(row.signalKind);
  if (!target || artifact.classification === "obsolete") {
    fail(`callsite ${row.callsiteDigest} lacks a semantic target`);
  }
  return {
    callsiteDigest: row.callsiteDigest,
    artifactId: row.artifactId,
    signalKind: row.signalKind,
    mutationClass: target,
    classification: artifact.classification,
    behaviorContextRoot: digest(
      "reference-callsite-behavior-context/v1",
      artifact.artifactId,
      ...artifact.behaviorFamilyIds,
    ),
    mutationGroupId: expectedGroupId(artifact.classification, target),
  };
}

function validateArtifacts(snapshot) {
  const { source, artifacts } = snapshot;
  if (!same(source, pinnedSource)) fail("source census and semantic roots are not pinned");
  if (source.schemaVersion !== "reference-source-census/v2") fail("source schema mismatch");
  if (artifacts.schemaVersion !== "reference-artifact-inventory/v2")
    fail("artifact schema mismatch");
  const binding = source.source;
  if (
    !hex40.test(binding.commit) ||
    !hex40.test(binding.treeObject) ||
    !hex64.test(binding.artifactRoot) ||
    !hex64.test(binding.entrypointRoot) ||
    !hex64.test(binding.effectCandidateRoot) ||
    !Object.values(source.semanticRoots).every((value) => hex64.test(value))
  )
    fail("source binding is malformed");
  if (binding.artifactCount !== 112 || artifacts.artifacts.length !== binding.artifactCount)
    fail("artifact count mismatch");
  const expectedIds = artifacts.artifacts.map(
    (_, index) => `artifact-${String(index + 1).padStart(3, "0")}`,
  );
  if (
    !same(
      artifacts.artifacts.map(({ artifactId }) => artifactId),
      expectedIds,
    )
  )
    fail("artifact identities are not complete and ordered");
  unique(artifacts.artifacts, ({ pathDigest }) => pathDigest, "artifact path digest census");
  for (const row of artifacts.artifacts) {
    exactKeys(
      row,
      [
        "artifactId",
        "pathDigest",
        "objectId",
        "contentDigest",
        "byteLength",
        "mode",
        "type",
        "extension",
        "classification",
        "behaviorFamilyIds",
        "disposition",
        ...(row.obsoleteEvidence ? ["obsoleteEvidence"] : []),
      ],
      `artifact ${row.artifactId}`,
    );
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
      !same(row.behaviorFamilyIds, sortedUnique(row.behaviorFamilyIds))
    )
      fail(`artifact ${row.artifactId} is malformed or unclassified`);
    if (row.classification === "obsolete" || row.disposition === "obsolete") {
      if (
        row.classification !== "obsolete" ||
        row.disposition !== "obsolete" ||
        !row.obsoleteEvidence ||
        !["probe", "decision"].includes(row.obsoleteEvidence.kind) ||
        !/^ISS-\d{3}$/.test(row.obsoleteEvidence.issue)
      )
        fail(`obsolete artifact ${row.artifactId} lacks explicit issue evidence`);
    } else if (row.disposition !== "characterize" || row.obsoleteEvidence)
      fail(`artifact ${row.artifactId} has an unsupported disposition`);
  }
  const artifactRows = artifacts.artifacts.map(artifactEvidence);
  if (aggregateRows("reference-artifact-root/v1", artifactRows) !== binding.artifactRoot)
    fail("artifact aggregate root mismatch");
  const semanticRoot = aggregateRows(
    "reference-artifact-semantic-root/v1",
    artifacts.artifacts.map(artifactSemanticEvidence),
  );
  if (artifacts.semanticRoot !== semanticRoot || source.semanticRoots.artifacts !== semanticRoot)
    fail("artifact semantic root mismatch");
  const extensionCensus = Object.fromEntries(
    sortedUnique(artifactRows.map(({ extension }) => extension)).map((extension) => [
      extension,
      artifactRows.filter((row) => row.extension === extension).length,
    ]),
  );
  if (!same(extensionCensus, source.extensionCensus)) fail("extension census mismatch");
  return artifactRows;
}

function validateBehaviors(snapshot) {
  const { source, behaviors } = snapshot;
  if (behaviors.schemaVersion !== "reference-behavior-families/v2")
    fail("behavior schema mismatch");
  const behaviorIds = unique(behaviors.families, ({ id }) => id, "behavior family census");
  for (const family of behaviors.families) {
    exactKeys(family, ["id", "classification", "capabilities"], `behavior family ${family.id}`);
    if (
      !classifications.has(family.classification) ||
      !Array.isArray(family.capabilities) ||
      family.capabilities.length === 0 ||
      !same(family.capabilities, sortedUnique(family.capabilities))
    )
      fail(`behavior family ${family.id} is unclassified`);
  }
  const root = aggregateRows("reference-behavior-root/v1", behaviors.families);
  if (behaviors.familyRoot !== root || source.semanticRoots.behaviors !== root)
    fail("behavior family root mismatch");
  return behaviorIds;
}

function validateEntrypoints(snapshot, artifactRows) {
  const { source, artifacts, entrypoints } = snapshot;
  const binding = source.source;
  if (
    entrypoints.schemaVersion !== "reference-entrypoint-census/v2" ||
    entrypoints.entrypointCount !== binding.entrypointCount ||
    entrypoints.entrypointRoot !== binding.entrypointRoot
  )
    fail("entrypoint binding mismatch");
  const executable = new Set(["ps1", "cjs", "sh", "vbs"]);
  const expected = artifacts.artifacts
    .filter(({ extension }) => executable.has(extension))
    .map((artifact, index) => ({
      entrypointId: `entrypoint-${String(index + 1).padStart(3, "0")}`,
      artifactId: artifact.artifactId,
      pathDigest: artifact.pathDigest,
      kind: artifact.extension,
      classification: artifact.classification,
      behaviorFamilyIds: artifact.behaviorFamilyIds,
      argumentPolicy: "explicit-only",
      authorityPolicy: "behavior-family-owned",
    }));
  if (!same(entrypoints.entrypoints.map(entrypointEvidence), expected))
    fail("entrypoint semantic map mismatch");
  const rawRows = expected.map(({ artifactId, pathDigest, kind }) => ({
    artifactId,
    pathDigest,
    kind,
  }));
  if (aggregateRows("reference-entrypoint-root/v1", rawRows) !== binding.entrypointRoot)
    fail("entrypoint aggregate root mismatch");
  const semanticRoot = aggregateRows("reference-entrypoint-semantic-root/v1", expected);
  if (
    entrypoints.semanticRoot !== semanticRoot ||
    source.semanticRoots.entrypoints !== semanticRoot ||
    expected.length !== artifactRows.filter(({ extension }) => executable.has(extension)).length
  )
    fail("entrypoint semantic root mismatch");
}

function validateAuthorities(snapshot) {
  const { source, authorities, transitions } = snapshot;
  if (authorities.schemaVersion !== "reference-authority-inventory/v2")
    fail("authority schema mismatch");
  const authorityIds = unique(authorities.authorities, ({ id }) => id, "authority census");
  const observationIds = unique(authorities.observations, ({ id }) => id, "observation census");
  for (const authority of authorities.authorities) {
    exactKeys(authority, ["id", "kind", "requiredObservation"], `authority ${authority.id}`);
    if (!observationIds.has(authority.requiredObservation))
      fail(`authority ${authority.id} is unobserved`);
  }
  for (const observation of authorities.observations)
    exactKeys(observation, ["id", "unavailableDisposition"], `observation ${observation.id}`);
  const authorityRoot = aggregateRows("reference-authority-root/v1", [
    ...authorities.authorities,
    ...authorities.observations,
  ]);
  if (
    authorities.authorityRoot !== authorityRoot ||
    source.semanticRoots.authorities !== authorityRoot
  )
    fail("authority root mismatch");
  if (transitions.schemaVersion !== "reference-recovery-transitions/v2")
    fail("transition schema mismatch");
  const transitionIds = unique(transitions.transitions, ({ id }) => id, "transition census");
  for (const transition of transitions.transitions) {
    exactKeys(transition, ["id", "from", "to", "preserves"], `transition ${transition.id}`);
    if (
      !Array.isArray(transition.preserves) ||
      transition.preserves.length === 0 ||
      !same(transition.preserves, sortedUnique(transition.preserves))
    )
      fail(`transition ${transition.id} is malformed`);
  }
  const transitionRoot = aggregateRows("reference-transition-root/v1", transitions.transitions);
  if (
    transitions.transitionRoot !== transitionRoot ||
    source.semanticRoots.transitions !== transitionRoot
  )
    fail("transition root mismatch");
  return { authorityIds, observationIds, transitionIds };
}

function validateMutations(snapshot, contractIds) {
  const { source, artifacts, mutations, authorities } = snapshot;
  const binding = source.source;
  if (
    mutations.schemaVersion !== "reference-mutation-census/v2" ||
    mutations.candidateCount !== binding.effectCandidateCount ||
    mutations.candidateRoot !== binding.effectCandidateRoot ||
    mutations.callsites.length !== binding.effectCandidateCount
  )
    fail("mutation candidate binding mismatch");
  unique(mutations.callsites, ({ callsiteDigest }) => callsiteDigest, "mutation callsite census");
  if (
    !same(
      mutations.callsites.map(({ callsiteDigest }) => callsiteDigest),
      sortedUnique(mutations.callsites.map(({ callsiteDigest }) => callsiteDigest)),
    )
  )
    fail("mutation callsites are not deterministically ordered");
  const artifactsById = new Map(artifacts.artifacts.map((row) => [row.artifactId, row]));
  const expectedCallsites = mutations.callsites.map((row) => {
    exactKeys(
      row,
      [
        "callsiteDigest",
        "artifactId",
        "signalKind",
        "mutationClass",
        "classification",
        "behaviorContextRoot",
        "mutationGroupId",
      ],
      `callsite ${row.callsiteDigest}`,
    );
    if (!hex64.test(row.callsiteDigest) || !artifactsById.has(row.artifactId))
      fail(`callsite ${row.callsiteDigest} is malformed or dangling`);
    return semanticCallsite(row, artifactsById.get(row.artifactId));
  });
  if (!same(mutations.callsites.map(callsiteEvidence), expectedCallsites))
    fail("mutation callsite semantic mapping mismatch");
  const rawRows = mutations.callsites.map(({ signalKind: kind, callsiteDigest: digest }) => ({
    kind,
    digest,
  }));
  if (aggregateRows("reference-effect-root/v1", rawRows) !== binding.effectCandidateRoot)
    fail("mutation raw candidate root mismatch");
  const census = Object.fromEntries(
    sortedUnique(mutations.callsites.map(({ signalKind }) => signalKind)).map((signalKind) => [
      signalKind,
      mutations.callsites.filter((row) => row.signalKind === signalKind).length,
    ]),
  );
  if (!same(census, source.effectCandidateCensus)) fail("mutation signal census mismatch");
  const semanticRoot = aggregateRows(
    "reference-semantic-mutation-root/v1",
    mutations.callsites.map(callsiteEvidence),
  );
  if (mutations.semanticRoot !== semanticRoot || source.semanticRoots.mutations !== semanticRoot)
    fail("mutation semantic root mismatch");
  const authorityById = new Map(authorities.authorities.map((row) => [row.id, row]));
  const expectedGroups = [];
  for (const mutationGroupId of sortedUnique(expectedCallsites.map((row) => row.mutationGroupId))) {
    const rows = expectedCallsites.filter((row) => row.mutationGroupId === mutationGroupId);
    const { classification, mutationClass } = rows[0];
    const contract = mutationContracts.get(`${classification}|${mutationClass}`);
    if (!contract) fail(`mutation group ${mutationGroupId} lacks a bounded contract`);
    expectedGroups.push({
      mutationGroupId,
      mutationClass,
      classification,
      signalKinds: sortedUnique(rows.map(({ signalKind }) => signalKind)),
      callsiteCount: rows.length,
      callsiteRoot: aggregateRows("reference-semantic-mutation-group/v1", rows),
      ...contract,
    });
  }
  if (!same(mutations.mutationGroups, expectedGroups))
    fail("mutation groups differ from the exact semantic callsite partition");
  for (const group of mutations.mutationGroups) {
    if (
      !contractIds.authorityIds.has(group.authorityId) ||
      !contractIds.observationIds.has(group.authorizingObservationId) ||
      !contractIds.transitionIds.has(group.recoveryTransitionId) ||
      authorityById.get(group.authorityId)?.requiredObservation !== group.authorizingObservationId
    )
      fail(`mutation group ${group.mutationGroupId} has incompatible authority evidence`);
  }
}

function validateAssumptions(snapshot, behaviorIds) {
  const { source, assumptions } = snapshot;
  if (assumptions.schemaVersion !== "reference-assumption-inventory/v2")
    fail("assumption schema mismatch");
  unique(assumptions.assumptions, ({ id }) => id, "assumption census");
  const observedIssues = new Set();
  for (const row of assumptions.assumptions) {
    if (!classifications.has(row.classification) || !behaviorIds.has(row.behaviorFamilyId))
      fail(`assumption ${row.id} is unclassified or dangling`);
    const expectedResolution = resolutionIssues.get(row.id);
    if (!same(row.resolution ?? null, expectedResolution ?? null))
      fail(`assumption ${row.id} has an unexpected resolution`);
    if (expectedResolution) {
      if (row.disposition !== `linked-${expectedResolution.kind}`)
        fail(`assumption ${row.id} has a mismatched resolution disposition`);
      if (observedIssues.has(expectedResolution.issue)) fail("resolution issues are not unique");
      observedIssues.add(expectedResolution.issue);
    } else if (row.disposition.startsWith("linked-"))
      fail(`assumption ${row.id} has a dangling linked disposition`);
  }
  if (!same([...observedIssues].sort(), ["ISS-022", "ISS-023"]))
    fail("resolution issue census must be exactly ISS-022 and ISS-023");
  const root = aggregateRows("reference-assumption-root/v1", assumptions.assumptions);
  if (assumptions.assumptionRoot !== root || source.semanticRoots.assumptions !== root)
    fail("assumption root mismatch");
  if (/\bunknown\b/i.test(JSON.stringify(snapshot))) fail("inventory contains an unlinked unknown");
}

function validateOracle(snapshot) {
  const { source, artifacts } = snapshot;
  const oracle = snapshot["redaction-oracle"];
  if (oracle.schemaVersion !== "reference-forbidden-vocabulary/v2")
    fail("redaction oracle schema mismatch");
  unique(oracle.entries, ({ digest: value }) => value, "redaction digest census");
  for (const row of oracle.entries) {
    exactKeys(row, ["digest", "neutralCapability", "matchPolicy"], "redaction oracle row");
    if (!hex64.test(row.digest) || !row.neutralCapability || !row.matchPolicy)
      fail("redaction oracle contains a raw or malformed row");
  }
  const vocabularyRoot = aggregateRows("reference-forbidden-vocabulary-root/v1", oracle.entries);
  if (
    oracle.vocabularyRoot !== vocabularyRoot ||
    source.semanticRoots.forbiddenVocabulary !== vocabularyRoot
  )
    fail("forbidden vocabulary root mismatch");
  const paths = oracle.sourcePathCensus;
  if (paths.artifactCount !== 112 || paths.entries.length !== artifacts.artifacts.length)
    fail("source path oracle does not cover every artifact");
  unique(paths.entries, ({ artifactId }) => artifactId, "source path artifact census");
  const expectedIdentity = artifacts.artifacts.map(({ artifactId, pathDigest }) => ({
    artifactId,
    pathDigest,
  }));
  const observedIdentity = paths.entries.map(({ artifactId, pathDigest }) => ({
    artifactId,
    pathDigest,
  }));
  if (!same(observedIdentity, expectedIdentity)) fail("source path oracle identity mismatch");
  for (const row of paths.entries) {
    exactKeys(
      row,
      [
        "artifactId",
        "pathDigest",
        "normalizedPathDigest",
        "componentDigests",
        "tokenDigests",
        "ngramDigests",
      ],
      `source path ${row.artifactId}`,
    );
    if (
      !hex64.test(row.normalizedPathDigest) ||
      ![row.componentDigests, row.tokenDigests, row.ngramDigests].every(
        (values) =>
          Array.isArray(values) &&
          values.length > 0 &&
          same(values, sortedUnique(values)) &&
          values.every((value) => hex64.test(value)),
      )
    )
      fail(`source path ${row.artifactId} lacks hashed component/token/ngram evidence`);
  }
  const pathRoot = aggregateRows("reference-source-path-census/v1", paths.entries);
  if (paths.pathEvidenceRoot !== pathRoot || source.semanticRoots.sourcePaths !== pathRoot)
    fail("source path oracle root mismatch");
  const componentUniverse = sortedUnique(
    paths.entries.flatMap(({ componentDigests }) => componentDigests),
  );
  const tokenUniverse = sortedUnique(paths.entries.flatMap(({ tokenDigests }) => tokenDigests));
  const sensitivity = paths.sensitivity;
  exactKeys(
    sensitivity,
    [
      "schemaVersion",
      "derivation",
      "componentUniverseCount",
      "tokenUniverseCount",
      "sensitiveComponentDigests",
      "componentCollisionDigests",
      "sensitiveTokenDigests",
      "tokenCollisionDigests",
      "arbitraryTextComponentCollisionDigests",
      "arbitraryTextTokenCollisionDigests",
      "sensitiveComponentCount",
      "componentCollisionCount",
      "sensitiveTokenCount",
      "tokenCollisionCount",
      "enforcedComponentCount",
      "enforcedTokenCount",
      "sensitivityRoot",
    ],
    "path sensitivity census",
  );
  const digestLists = [
    sensitivity.sensitiveComponentDigests,
    sensitivity.componentCollisionDigests,
    sensitivity.sensitiveTokenDigests,
    sensitivity.tokenCollisionDigests,
    sensitivity.arbitraryTextComponentCollisionDigests,
    sensitivity.arbitraryTextTokenCollisionDigests,
  ];
  const enforcedComponents = sensitivity.sensitiveComponentDigests.filter(
    (value) => !sensitivity.arbitraryTextComponentCollisionDigests.includes(value),
  );
  const enforcedTokens = sensitivity.sensitiveTokenDigests.filter(
    (value) => !sensitivity.arbitraryTextTokenCollisionDigests.includes(value),
  );
  if (
    sensitivity.schemaVersion !== "reference-path-sensitivity/v1" ||
    !digestLists.every(
      (values) =>
        Array.isArray(values) &&
        same(values, sortedUnique(values)) &&
        values.every((value) => hex64.test(value)),
    ) ||
    sensitivity.componentUniverseCount !== componentUniverse.length ||
    sensitivity.tokenUniverseCount !== tokenUniverse.length ||
    sensitivity.sensitiveComponentCount !== sensitivity.sensitiveComponentDigests.length ||
    sensitivity.componentCollisionCount !== sensitivity.componentCollisionDigests.length ||
    sensitivity.sensitiveTokenCount !== sensitivity.sensitiveTokenDigests.length ||
    sensitivity.tokenCollisionCount !== sensitivity.tokenCollisionDigests.length ||
    sensitivity.enforcedComponentCount !== enforcedComponents.length ||
    sensitivity.enforcedTokenCount !== enforcedTokens.length ||
    !same(
      sortedUnique([
        ...sensitivity.sensitiveComponentDigests,
        ...sensitivity.componentCollisionDigests,
      ]),
      componentUniverse,
    ) ||
    !same(
      sortedUnique([...sensitivity.sensitiveTokenDigests, ...sensitivity.tokenCollisionDigests]),
      tokenUniverse,
    ) ||
    sensitivity.sensitiveComponentDigests.some((value) =>
      sensitivity.componentCollisionDigests.includes(value),
    ) ||
    sensitivity.sensitiveTokenDigests.some((value) =>
      sensitivity.tokenCollisionDigests.includes(value),
    ) ||
    !sensitivity.arbitraryTextComponentCollisionDigests.every((value) =>
      sensitivity.sensitiveComponentDigests.includes(value),
    ) ||
    !sensitivity.arbitraryTextTokenCollisionDigests.every((value) =>
      sensitivity.sensitiveTokenDigests.includes(value),
    )
  )
    fail("path sensitivity census is incomplete or overlapping");
  const sensitivityEvidence = {
    schemaVersion: sensitivity.schemaVersion,
    derivation: sensitivity.derivation,
    componentUniverseCount: sensitivity.componentUniverseCount,
    tokenUniverseCount: sensitivity.tokenUniverseCount,
    sensitiveComponentDigests: sensitivity.sensitiveComponentDigests,
    componentCollisionDigests: sensitivity.componentCollisionDigests,
    sensitiveTokenDigests: sensitivity.sensitiveTokenDigests,
    tokenCollisionDigests: sensitivity.tokenCollisionDigests,
    arbitraryTextComponentCollisionDigests: sensitivity.arbitraryTextComponentCollisionDigests,
    arbitraryTextTokenCollisionDigests: sensitivity.arbitraryTextTokenCollisionDigests,
    sensitiveComponentCount: sensitivity.sensitiveComponentCount,
    componentCollisionCount: sensitivity.componentCollisionCount,
    sensitiveTokenCount: sensitivity.sensitiveTokenCount,
    tokenCollisionCount: sensitivity.tokenCollisionCount,
    enforcedComponentCount: sensitivity.enforcedComponentCount,
    enforcedTokenCount: sensitivity.enforcedTokenCount,
  };
  const sensitivityRoot = aggregateRows("reference-path-sensitivity-root/v1", [
    sensitivityEvidence,
  ]);
  if (
    sensitivity.sensitivityRoot !== sensitivityRoot ||
    source.semanticRoots.pathSensitivity !== sensitivityRoot
  )
    fail("path sensitivity root mismatch");
  if (
    !same(oracle.copyPolicy, {
      minimumNormalizedBytes: 160,
      boundaryDisposition: "159-bytes-allowed-160-bytes-rejected-at-every-offset",
    })
  )
    fail("copied-source boundary policy mismatch");
  const publication = buildPublicationFingerprints(snapshot).census;
  if (
    !same(oracle.publicationFingerprintCensus, publication) ||
    source.semanticRoots.publicationFingerprints !== publication.fingerprintRoot
  )
    fail("publication fingerprint census mismatch");
}

async function validateResolutionIssueFiles(root) {
  for (const { kind, issue } of resolutionIssues.values()) {
    let text;
    try {
      text = normalizeTrackedText(
        await readFile(resolve(root, "planning/drafts", `${issue}.md`), "utf8"),
      );
    } catch {
      fail(`resolution issue ${issue} does not exist`);
    }
    if (!new RegExp(`^key: ${issue}$`, "m").test(text) || !text.includes(`type:${kind}`))
      fail(`resolution issue ${issue} has the wrong kind`);
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
    result[name] = JSON.parse(source);
  }
  await validateResolutionIssueFiles(root);
  return result;
}

export function validateInventory(snapshot) {
  const artifactRows = validateArtifacts(snapshot);
  const behaviorIds = validateBehaviors(snapshot);
  for (const artifact of snapshot.artifacts.artifacts)
    if (artifact.behaviorFamilyIds.some((id) => !behaviorIds.has(id)))
      fail(`artifact ${artifact.artifactId} has a dangling behavior family`);
  validateEntrypoints(snapshot, artifactRows);
  const contractIds = validateAuthorities(snapshot);
  validateMutations(snapshot, contractIds);
  validateAssumptions(snapshot, behaviorIds);
  validateOracle(snapshot);
  return {
    artifactCount: snapshot.source.source.artifactCount,
    entrypointCount: snapshot.source.source.entrypointCount,
    effectCandidateCount: snapshot.source.source.effectCandidateCount,
    mutationGroupCount: snapshot.mutations.mutationGroups.length,
    sourcePathCount: snapshot["redaction-oracle"].sourcePathCensus.entries.length,
    sensitiveComponentCount:
      snapshot["redaction-oracle"].sourcePathCensus.sensitivity.enforcedComponentCount,
    sensitiveTokenCount:
      snapshot["redaction-oracle"].sourcePathCensus.sensitivity.enforcedTokenCount,
    unresolved: resolutionIssues.size,
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
  )
    fail("live source binding or census differs from the sanitized inventory");
  if (!same(evidence.artifacts, snapshot.artifacts.artifacts.map(artifactEvidence)))
    fail("live artifact rows differ");
  if (
    evidence.sourcePathRoot !== snapshot.source.semanticRoots.sourcePaths ||
    !same(evidence.sourcePaths, snapshot["redaction-oracle"].sourcePathCensus.entries)
  )
    fail("live source path oracle differs");
  const observedCandidates = evidence.candidates.map(
    ({ artifactId, kind: signalKind, digest: callsiteDigest }) => ({
      artifactId,
      signalKind,
      callsiteDigest,
    }),
  );
  const expectedCandidates = snapshot.mutations.callsites.map(
    ({ artifactId, signalKind, callsiteDigest }) => ({ artifactId, signalKind, callsiteDigest }),
  );
  if (!same(observedCandidates, expectedCandidates))
    fail("live mutation callsite set or artifact mapping differs");
  return {
    artifactCount: evidence.artifactCount,
    artifactRoot: evidence.artifactRoot,
    sourcePathRoot: evidence.sourcePathRoot,
    entrypointCount: evidence.entrypointCount,
    effectCandidateCount: evidence.effectCandidateCount,
    effectCandidateRoot: evidence.effectCandidateRoot,
    semanticMutationRoot: snapshot.mutations.semanticRoot,
  };
}

export async function runInventoryCli(argv, root = defaultRoot) {
  const live = parseLiveArguments(argv);
  const snapshot = await loadInventory(root);
  const summary = validateInventory(snapshot);
  const liveSummary = live ? await compareLiveSource(snapshot, live) : undefined;
  process.stdout.write(
    `${JSON.stringify({ schemaVersion: "reference-inventory-check/v2", outcome: "success", ...summary, live: liveSummary })}\n`,
  );
}

export const inventoryTestApi = Object.freeze({
  aggregateRows,
  artifactSemanticEvidence,
  callsiteEvidence,
  entrypointEvidence,
  semanticCallsite,
  buildPublicationFingerprints,
  publicationValueFingerprints,
  publicationStreamFingerprints,
});

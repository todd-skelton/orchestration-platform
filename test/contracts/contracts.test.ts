import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import * as publicApi from "../../packages/contracts/src/index.js";
import {
  canonicalBytes,
  canonicalDigest,
  classifyProposal,
  computeConflictDigest,
  computeCurrentTipDigest,
  computeMutationId,
  computePointerInstanceDigest,
  computePointerPositionDigest,
  computePointerValueDigest,
  computeProposalReceiptDigest,
  computeRecoveryAuthorizationCoreDigest,
  computeReservationPredecessorKey,
  diagnostic,
  derivePointerPositionEvidence,
  fixedEvidencePacketLimits,
  framedBytes,
  isCleanupLifecyclePublicationPair,
  isCleanupLifecyclePublicationTransition,
  ordinaryEpochSequence,
  parseCanonicalContractBytes,
  parseContract,
  pointerKinds,
  pointerArchivePaths,
  pointerGenesisRule,
  pointerPath,
  pointerPositionContracts,
  pointerRegistry,
  pointerRootPaths,
  recoveryAccumulatorDigest,
  retentionAllows,
  reduceCleanupHeadWrite,
  schemaDefinitions,
  schemaVersions,
  serializeContract,
  snapshotClosedArray,
  stateMutationAuthorityPath,
  stateMutationLockPath,
  stateMutationRegistry,
  validateEpochSequence,
  validateAuthorizationReceiptChain,
  validateAuthorizationRevokeReceiptChain,
  validateGateAuthorizationBinding,
  validateEvidencePacket,
  validateFenceHeadHistory,
  validatePointerDispatch,
  validatePointerGenesisDispatch,
  validatePointerPositionEvidence,
  validatePointerTemplateDispatch,
  validateRecoveryAccumulatorFormula,
  validateSelectedPointerEvidence,
  validateCleanupHeadHistory,
  validateRetentionTransition,
  validateRotationCensus,
  v2SchemaVersions,
  type ContractRecord,
  type FieldRule,
  type JsonValue,
} from "../../packages/contracts/src/index.js";
import { digest, digest2, fixtureFor, instant, uuid, uuid2 } from "./fixtures.js";

function invalidFor(rule: FieldRule): unknown {
  if (rule.array) return { no: "array" };
  if (rule.values) return "FUTURE";
  switch (rule.kind) {
    case "boolean":
      return "false";
    case "bounded-string":
      return "";
    case "decimal":
      return "01";
    case "file-url":
      return "/absolute";
    case "integer":
    case "positive-integer":
      return Number.MAX_SAFE_INTEGER + 1;
    case "opaque":
      return "contains spaces";
    case "relative-path":
      return "../escape";
    case "schema-id":
      return "schema/latest";
    case "semver":
      return "1";
    case "sha256":
      return digest.toUpperCase();
    case "timestamp":
      return "2026-08-16";
    case "uuid-v7":
      return "not-a-uuid";
  }
}

function pointerSelection(
  pointerKind: (typeof pointerKinds)[number],
  value: ContractRecord,
  options: {
    pathBindings: Record<string, string>;
    transactionId: string | null;
    sourceToken: string;
    prior?: { tipDigest: string; valueDigest: string; proposalReceiptDigest: string } | null;
    authorityEpoch?: { tipDigest: string; valueDigest: string; proposalReceiptDigest: string };
    tombstoneEvidence?: ContractRecord;
    intent?: "VALUE_PROPOSED" | "TOMBSTONE_PROPOSED";
    outcome?: "SELECT" | "REMOVE";
    installationId?: string;
    projectId?: string;
    stateRootDigest?: string;
  },
) {
  const canonicalPointerPath = pointerPath(pointerKind, options.pathBindings);
  const row = pointerRegistry.find((candidate) => candidate.kind === pointerKind)!;
  const pointerInput = {
    pointerKind,
    canonicalPointerPath,
    installationId: options.installationId ?? uuid,
    projectId: options.projectId ?? uuid,
    stateRootDigest: options.stateRootDigest ?? digest,
    transactionId: options.transactionId,
    sourceToken: options.sourceToken,
    ...(row.pathTemplate.includes("<predecessor-key>")
      ? { predecessorKey: options.pathBindings.predecessorKey }
      : {}),
    ...(row.pathTemplate.includes("<pointer-instance-digest>")
      ? { retainedPointerInstanceDigest: options.pathBindings.pointerInstanceDigest }
      : {}),
  };
  const pathInstanceDigest = computePointerInstanceDigest(pointerInput);
  const valueDigest = computePointerValueDigest(pointerKind, pathInstanceDigest, value);
  const positionEvidence = derivePointerPositionEvidence(pointerKind, value, options.pathBindings);
  const positionDigest = computePointerPositionDigest(pointerKind, positionEvidence);
  const prior = options.prior ?? null;
  const tombstone = value.schemaVersion === "pointer-tombstone-value/v1";
  const intent = options.intent ?? (tombstone ? "TOMBSTONE_PROPOSED" : "VALUE_PROPOSED");
  const outcome = options.outcome ?? (tombstone ? "REMOVE" : "SELECT");
  const mutationInput = {
    pointerKind,
    canonicalPointerPath,
    pathInstanceDigest,
    transactionId: options.transactionId,
    sourceToken: options.sourceToken,
    positionEvidence,
    priorDt: prior?.tipDigest ?? null,
    priorDv: prior?.valueDigest ?? null,
    priorDr: prior?.proposalReceiptDigest ?? null,
    successorDv: valueDigest,
    outcome,
    intent,
    ...(row.pathTemplate.includes("<predecessor-key>")
      ? { predecessorKey: options.pathBindings.predecessorKey }
      : {}),
    ...(row.pathTemplate.includes("<pointer-instance-digest>")
      ? { retainedPointerInstanceDigest: options.pathBindings.pointerInstanceDigest }
      : {}),
  };
  const mutationId = computeMutationId(mutationInput);
  const epoch = options.authorityEpoch ?? {
    tipDigest: digest,
    valueDigest: digest,
    proposalReceiptDigest: digest,
  };
  const proposal: ContractRecord = {
    ...fixtureFor("pointer-cas-proposal-receipt/v1"),
    pointerKind,
    pathInstanceDigest,
    mutationId,
    priorTipDigest: mutationInput.priorDt,
    priorValueDigest: mutationInput.priorDv,
    priorReceiptDigest: mutationInput.priorDr,
    successorValueDigest: valueDigest,
    positionDigest,
    outcome,
    intent,
    authorityEpochTipDigest: epoch.tipDigest,
    authorityEpochValueDigest: epoch.valueDigest,
    authorityEpochReceiptDigest: epoch.proposalReceiptDigest,
  };
  const proposalReceiptDigest = computeProposalReceiptDigest({
    pointerKind,
    pathInstanceDigest,
    mutationId,
    priorDt: mutationInput.priorDt,
    priorDv: mutationInput.priorDv,
    priorDr: mutationInput.priorDr,
    successorDv: valueDigest,
    positionDigest,
    outcome,
    intent,
    receipt: proposal,
  });
  const tip: ContractRecord = {
    ...fixtureFor("pointer-current-tip/v1"),
    pointerKind,
    pathInstanceDigest,
    valueDigest,
    proposalReceiptDigest,
  };
  const tipDigest = computeCurrentTipDigest(
    pointerKind,
    pathInstanceDigest,
    valueDigest,
    proposalReceiptDigest,
    tip,
  );
  const envelope = {
    pointerKind,
    canonicalPointerPath,
    installationId: options.installationId ?? uuid,
    projectId: options.projectId ?? uuid,
    stateRootDigest: options.stateRootDigest ?? digest,
    transactionId: options.transactionId,
    sourceToken: options.sourceToken,
    pathBindings: options.pathBindings,
    positionEvidence,
    tombstoneEvidence: options.tombstoneEvidence ?? null,
    value,
    proposal,
    tip,
  };
  return {
    envelope,
    pathInstanceDigest,
    proposal,
    proposalReceiptDigest,
    tip,
    tipDigest,
    valueDigest,
  };
}

function authorizationSelection(
  core: ContractRecord,
  state: ContractRecord,
  prior: { tipDigest: string; valueDigest: string; proposalReceiptDigest: string } | null = null,
) {
  return pointerSelection("RECOVERY_AUTHORIZATION_STATE", state, {
    pathBindings: { transactionId: core.transactionId as string },
    transactionId: core.transactionId as string,
    sourceToken: "none",
    prior,
  });
}

function terminalPointerValue(
  kind: (typeof pointerKinds)[number],
  base: ContractRecord,
): ContractRecord {
  switch (kind) {
    case "ACTIVE_RELEASE":
    case "ACTIVATION_CLEANUP_ARCHIVE_HEAD":
      return base;
    case "ACTIVATION_CLEANUP_GATE":
      return {
        ...base,
        lifecycle: "COMPLETE",
        publication: "CLEARED",
        fenceDigest: null,
        abortRevocationReceiptDigest: null,
        terminalRevocationReceiptDigest: digest,
        terminalProofDigest: digest,
        archiveOutcomeDigest: digest,
      };
    case "ACTIVATION_RECOVERY_FENCE":
      return { ...base, lifecycle: "POST_ACTIVATION" };
    case "ACTIVATION_RECOVERY_LAUNCH":
      return { ...base, lifecycle: "TERMINAL_COMPLETE", terminalProofDigest: digest };
    case "RECOVERY_AUTHORIZATION_STATE":
      return {
        ...base,
        lifecycle: "REVOKED",
        gateRootDigest: digest,
        nativeConsumeReceiptDigest: digest,
        nativeRemovalReceiptDigest: digest,
      };
    case "RECOVERY_AUTHORIZATION_ATTACHMENT":
      return {
        ...base,
        lifecycle: "TERMINAL",
        reservationTipDigest: digest,
        reservationValueDigest: digest,
        reservationReceiptDigest: digest,
        descriptorDigest: digest,
        readyRecordDigest: digest,
        initialLiveRecordDigest: digest,
        gateHeadDigest: digest,
        fenceHeadDigest: digest,
        activeReleaseDigest: digest,
        brokerClientDigest: digest,
        argvDigest: digest,
        processIdentityDigest: digest,
        terminalSummaryDigest: digest,
      };
    case "RECOVERY_ATTEMPT_ACCUMULATOR":
      return {
        ...base,
        lifecycle: "TERMINAL",
        terminalSummaryDigest: digest,
        rollingDigest: digest,
      };
    case "RECOVERY_ATTEMPT_RESERVATION":
      return {
        ...base,
        lifecycle: "TERMINAL",
        consumedDescriptorDigest: digest,
        terminalSummaryDigest: digest,
      };
    default:
      return base;
  }
}

function ordinarySelection(
  row: (typeof pointerRegistry)[number],
  identities: { installationId?: string; projectId?: string; stateRootDigest?: string } = {},
  terminal = false,
) {
  const rawValue = fixtureFor(row.valueSchemas[0]!);
  const baseValue = terminal ? terminalPointerValue(row.kind, rawValue) : rawValue;
  const value: ContractRecord = {
    ...baseValue,
    ...(Object.hasOwn(baseValue, "installationId") && identities.installationId
      ? { installationId: identities.installationId }
      : {}),
    ...(Object.hasOwn(baseValue, "projectId") && identities.projectId
      ? { projectId: identities.projectId }
      : {}),
    ...(Object.hasOwn(baseValue, "stateRootDigest") && identities.stateRootDigest
      ? { stateRootDigest: identities.stateRootDigest }
      : {}),
  };
  const transactionId = row.transactionPolicy === "REQUIRED" ? uuid : null;
  const sourceToken = row.sourceTokens[0]!;
  const pathBindings: Record<string, string> = {
    ...(row.pathTemplate.includes("<transaction>") ? { transactionId: uuid } : {}),
    ...(row.pathTemplate.includes("<source>") ? { sourceToken } : {}),
    ...(row.pathTemplate.includes("<predecessor-key>")
      ? {
          predecessorKey: computeReservationPredecessorKey({
            transactionId: uuid,
            sourceToken,
            priorDt: value.predecessorAccumulatorTipDigest,
            priorDv: value.predecessorAccumulatorValueDigest,
            priorDr: value.predecessorAccumulatorReceiptDigest,
          }),
        }
      : {}),
    ...(row.pathTemplate.includes("<pointer-instance-digest>")
      ? { pointerInstanceDigest: value.pathInstanceDigest as string }
      : {}),
  };
  return pointerSelection(row.kind, value, {
    pathBindings,
    transactionId,
    sourceToken,
    ...identities,
  });
}

function tombstoneSelection(
  row: (typeof pointerRegistry)[number],
  priorSelection = ordinarySelection(row, {}, true),
) {
  const transactionId = priorSelection.envelope.transactionId as string;
  const sourceToken = priorSelection.envelope.sourceToken as string;
  const pathBindings = priorSelection.envelope.pathBindings as Record<string, string>;
  const canonicalPointerPath = pointerPath(row.kind, pathBindings);
  const archiveTemplate = row.archiveTemplates[0]!;
  const archiveBindings: Record<string, string> = {
    ...(archiveTemplate.includes("<transaction>") ? { transactionId: uuid } : {}),
    ...(archiveTemplate.includes("<source>") ? { sourceToken } : {}),
    ...(archiveTemplate.includes("<predecessor-key>") ? { predecessorKey: digest } : {}),
    ...(archiveTemplate.includes("<pointer-instance-digest>")
      ? { pointerInstanceDigest: digest }
      : {}),
    ...(archiveTemplate.includes("<release-digest>") ? { releaseDigest: digest } : {}),
  };
  const archivePath = pointerArchivePaths(row.kind, archiveBindings)[0]!;
  const prior = {
    tipDigest: priorSelection.tipDigest,
    valueDigest: priorSelection.valueDigest,
    proposalReceiptDigest: priorSelection.proposalReceiptDigest,
  };
  const authorityEpoch = { tipDigest: digest, valueDigest: digest, proposalReceiptDigest: digest };
  const terminalProof: ContractRecord = {
    schemaVersion: "pointer-terminal-proof/v1",
    authorityEpochReceiptDigest: authorityEpoch.proposalReceiptDigest,
    authorityEpochTipDigest: authorityEpoch.tipDigest,
    authorityEpochValueDigest: authorityEpoch.valueDigest,
    priorAuthorityEpochReceiptDigest: (priorSelection.proposal as ContractRecord)
      .authorityEpochReceiptDigest as string,
    priorAuthorityEpochTipDigest: (priorSelection.proposal as ContractRecord)
      .authorityEpochTipDigest as string,
    priorAuthorityEpochValueDigest: (priorSelection.proposal as ContractRecord)
      .authorityEpochValueDigest as string,
    canonicalPointerPath,
    installationId: uuid,
    pathInstanceDigest: priorSelection.pathInstanceDigest,
    pointerKind: row.kind,
    projectId: uuid,
    sourceToken,
    stateRootDigest: digest,
    terminalReceiptDigest: prior.proposalReceiptDigest,
    terminalTipDigest: prior.tipDigest,
    terminalValueDigest: prior.valueDigest,
    terminalPositionDigest: computePointerPositionDigest(
      row.kind,
      priorSelection.envelope.positionEvidence,
    ),
    terminalValueSchemaVersion: (priorSelection.envelope.value as ContractRecord)
      .schemaVersion as string,
    transactionId,
  };
  const terminalProofDigest = canonicalDigest(terminalProof);
  const archiveRecord: ContractRecord = {
    schemaVersion: "pointer-archive-record/v1",
    archivePath,
    archivedAt: instant,
    authorityEpochReceiptDigest: authorityEpoch.proposalReceiptDigest,
    authorityEpochTipDigest: authorityEpoch.tipDigest,
    authorityEpochValueDigest: authorityEpoch.valueDigest,
    priorAuthorityEpochReceiptDigest: (priorSelection.proposal as ContractRecord)
      .authorityEpochReceiptDigest as string,
    priorAuthorityEpochTipDigest: (priorSelection.proposal as ContractRecord)
      .authorityEpochTipDigest as string,
    priorAuthorityEpochValueDigest: (priorSelection.proposal as ContractRecord)
      .authorityEpochValueDigest as string,
    canonicalPointerPath,
    installationId: uuid,
    pathInstanceDigest: priorSelection.pathInstanceDigest,
    pointerKind: row.kind,
    priorReceiptDigest: prior.proposalReceiptDigest,
    priorTipDigest: prior.tipDigest,
    priorValueDigest: prior.valueDigest,
    priorPositionDigest: terminalProof.terminalPositionDigest as string,
    priorValueSchemaVersion: terminalProof.terminalValueSchemaVersion as string,
    projectId: uuid,
    sourceToken,
    stateRootDigest: digest,
    terminalProofDigest,
    transactionId,
  };
  const tombstone: ContractRecord = {
    ...fixtureFor("pointer-tombstone-value/v1"),
    pointerKind: row.kind,
    priorTipDigest: prior.tipDigest,
    priorValueDigest: prior.valueDigest,
    priorReceiptDigest: prior.proposalReceiptDigest,
    archiveDigest: canonicalDigest(archiveRecord),
    terminalProofDigest,
  };
  const tombstoneEvidence: ContractRecord = {
    archiveBindings,
    archivePath,
    archiveRecord,
    priorSelection: priorSelection.envelope,
    terminalProof,
  };
  return pointerSelection(row.kind, tombstone, {
    pathBindings,
    transactionId,
    sourceToken,
    prior,
    authorityEpoch,
    tombstoneEvidence,
  });
}

describe("current and diagnostic schema registries", () => {
  test("pins eleven pointer kinds, one lock, and exact canonical paths", () => {
    expect(pointerKinds).toHaveLength(11);
    expect(pointerRegistry.map((row) => row.kind)).toEqual(pointerKinds);
    expect(new Set(pointerKinds).size).toBe(11);
    expect(stateMutationLockPath).toBe("installation/state-mutation.lock");
    expect(stateMutationAuthorityPath).toBe("installation/state-mutation-authority.json");
    expect(stateMutationRegistry.lock).toEqual({
      path: stateMutationLockPath,
      singleton: true,
      symlinkAllowed: false,
    });
    expect(pointerRegistry.filter((row) => row.singleton)).toHaveLength(5);
    expect(pointerRegistry.filter((row) => row.transactionPolicy === "REQUIRED")).toHaveLength(9);
    expect(pointerRegistry.filter((row) => row.transactionPolicy === "NULL")).toHaveLength(2);
    expect(pointerRegistry.filter((row) => row.sourcePolicy === "RECOVERY_SOURCE")).toHaveLength(3);
    expect(canonicalDigest(pointerPositionContracts)).toBe(
      "a0cad57365d1a01363a9c14db1979fd1f76edefc2a120ef0a67446e132b3ba09",
    );
    const constructedPathCensus: JsonValue[] = [];
    for (const row of pointerRegistry) {
      expect(row.rootTemplates.length, `${row.kind}:roots`).toBeGreaterThan(0);
      expect(row.archiveTemplates.length, `${row.kind}:archives`).toBeGreaterThan(0);
      expect(row.valueSchemas.length, `${row.kind}:schemas`).toBeGreaterThan(0);
      const rootTemplate = row.rootTemplates[0]!;
      const rootBindings = {
        ...(rootTemplate.includes("<transaction>") ? { transactionId: uuid } : {}),
        ...(rootTemplate.includes("<source>") ? { sourceToken: row.sourceTokens[0]! } : {}),
        ...(rootTemplate.includes("<predecessor-key>") ? { predecessorKey: digest } : {}),
        ...(rootTemplate.includes("<pointer-instance-digest>")
          ? { pointerInstanceDigest: digest }
          : {}),
        ...(rootTemplate.includes("<release-digest>") ? { releaseDigest: digest } : {}),
      };
      const roots = pointerRootPaths(row.kind, rootBindings);
      expect(validatePointerTemplateDispatch(row.kind, "ROOT", roots, rootBindings)).toEqual([]);
      expect(
        validatePointerTemplateDispatch(row.kind, "ROOT", [`${roots[0]}alias`], rootBindings),
      ).not.toEqual([]);
      const archiveTemplate = row.archiveTemplates[0]!;
      const archiveBindings = {
        ...(archiveTemplate.includes("<transaction>") ? { transactionId: uuid } : {}),
        ...(archiveTemplate.includes("<source>") ? { sourceToken: row.sourceTokens[0]! } : {}),
        ...(archiveTemplate.includes("<predecessor-key>") ? { predecessorKey: digest } : {}),
        ...(archiveTemplate.includes("<pointer-instance-digest>")
          ? { pointerInstanceDigest: digest }
          : {}),
        ...(archiveTemplate.includes("<release-digest>") ? { releaseDigest: digest } : {}),
      };
      const archives = pointerArchivePaths(row.kind, archiveBindings);
      expect(
        validatePointerTemplateDispatch(row.kind, "ARCHIVE", archives, archiveBindings),
      ).toEqual([]);
      expect(validatePointerGenesisDispatch(row.kind, pointerGenesisRule(row.kind))).toEqual([]);
      expect(validatePointerGenesisDispatch(row.kind, "FUTURE")).not.toEqual([]);
      const positionValue = fixtureFor(row.valueSchemas[0]!);
      const positionBindings =
        row.kind === "RECOVERY_ATTEMPT_RESERVATION"
          ? {
              predecessorKey: computeReservationPredecessorKey({
                transactionId: positionValue.transactionId,
                sourceToken: positionValue.sourceToken,
                priorDt: positionValue.predecessorAccumulatorTipDigest,
                priorDv: positionValue.predecessorAccumulatorValueDigest,
                priorDr: positionValue.predecessorAccumulatorReceiptDigest,
              }),
            }
          : {};
      const position = derivePointerPositionEvidence(row.kind, positionValue, positionBindings);
      const positionDigest = computePointerPositionDigest(row.kind, position);
      expect(validatePointerPositionEvidence(row.kind, position)).toEqual([]);
      for (const field of pointerPositionContracts[row.kind].ordinaryFields) {
        const invalid = field === "previousArchiveHeadDigest" ? "invalid" : null;
        expect(
          validatePointerPositionEvidence(row.kind, { ...position, [field]: invalid }),
          `${row.kind}:${field}`,
        ).not.toEqual([]);
        if (["lifecycle", "phase", "rotationKind", "sourceToken"].includes(field))
          expect(
            validatePointerPositionEvidence(row.kind, { ...position, [field]: "FUTURE" }),
            `${row.kind}:${field}:future`,
          ).not.toEqual([]);
        if (field === "ordinal")
          for (const ordinal of [-1, 1.5, "1"])
            expect(
              validatePointerPositionEvidence(row.kind, { ...position, ordinal }),
              `${row.kind}:ordinal:${ordinal}`,
            ).not.toEqual([]);
        if (field.endsWith("Digest") || field === "predecessorKey")
          for (const malformed of ["a", digest.toUpperCase(), 1])
            expect(
              validatePointerPositionEvidence(row.kind, { ...position, [field]: malformed }),
              `${row.kind}:${field}:malformed`,
            ).not.toEqual([]);
      }
      expect(
        validatePointerPositionEvidence(row.kind, { ...position, variant: "FUTURE" }),
      ).not.toEqual([]);
      expect(() => computePointerPositionDigest(row.kind, { ...position, extra: digest })).toThrow(
        /shape-invalid/,
      );
      const otherKind = pointerKinds.find((kind) => kind !== row.kind)!;
      expect(() => computePointerPositionDigest(otherKind, position)).toThrow();
      constructedPathCensus.push({
        archives,
        genesis: pointerGenesisRule(row.kind),
        kind: row.kind,
        positionDigest,
        roots,
      });
    }
    expect(canonicalDigest(constructedPathCensus)).toBe(
      "065658021f5e54567429415c2fc80ac52487f5a68ac9402176ee456cd3319d60",
    );
    const familyCensus = pointerRegistry.map((row) => ({
      archiveTemplates: row.archiveTemplates,
      genesis: row.genesis,
      kind: row.kind,
      positionDomain: row.positionDomain,
      rootTemplates: row.rootTemplates,
      sourcePolicy: row.sourcePolicy,
      tombstonePositionDomain: row.tombstonePositionDomain,
      transactionPolicy: row.transactionPolicy,
      valueDigests: row.valueSchemas.map((schemaVersion) =>
        canonicalDigest(fixtureFor(schemaVersion)),
      ),
      valueSchemas: row.valueSchemas,
    }));
    expect(canonicalDigest(familyCensus)).toBe(
      "c6ccc196c809eb19e338a52baaf352b56cf210be90706b88061ec1e4e70b7b31",
    );
    expect(pointerPath("ACTIVE_RELEASE")).toBe("installation/active-release.json");
    expect(pointerPath("RECOVERY_AUTHORIZATION_STATE", { transactionId: uuid })).toBe(
      `installation/recovery-authorizations/${uuid}/state.json`,
    );
    const genesisPredecessorKey = computeReservationPredecessorKey({
      transactionId: uuid,
      sourceToken: "recovery-fence-v2",
      priorDt: null,
      priorDv: null,
      priorDr: null,
    });
    expect(
      pointerPath("RECOVERY_ATTEMPT_RESERVATION", {
        transactionId: uuid,
        sourceToken: "recovery-fence-v2",
        predecessorKey: genesisPredecessorKey,
      }),
    ).toBe(
      `installation/activation-recovery-launches/${uuid}/recovery-fence-v2/reservations/${genesisPredecessorKey}.json`,
    );
    expect(() =>
      pointerPath("RECOVERY_ATTEMPT_RESERVATION", {
        transactionId: "../bad",
        sourceToken: "recovery-fence-v2",
        predecessorKey: computeReservationPredecessorKey({
          transactionId: uuid,
          sourceToken: "recovery-fence-v2",
          priorDt: null,
          priorDv: null,
          priorDr: null,
        }),
      }),
    ).toThrow();
    expect(pointerPath("AUTHORITY_RETENTION", { pointerInstanceDigest: digest })).toBe(
      `installation/authority-retention/${digest}.json`,
    );
    expect(() =>
      pointerPath("AUTHORITY_RETENTION", { pointerInstanceDigest: null as never }),
    ).toThrow();
    expect(
      validatePointerDispatch(
        "ACTIVE_RELEASE",
        "installation/active-release.json",
        "active-release/v2",
      ),
    ).toEqual([]);
    expect(
      validatePointerDispatch(
        "ACTIVE_RELEASE",
        "installation/active-release.json",
        "active-release/v1",
      ),
    ).toContain("schemaVersion:wrong-pointer-family");
    expect(
      validatePointerDispatch("ACTIVE_RELEASE", "installation/other.json", "active-release/v2"),
    ).toContain("pointerPath:mismatch");
    expect(() =>
      pointerPath("ACTIVATION_RECOVERY_LAUNCH", {
        transactionId: uuid,
        sourceToken: "recovery-fence/v1",
      }),
    ).toThrow();
    expect(() => pointerPath("ACTIVE_RELEASE", { transactionId: uuid })).toThrow();
  });

  test("exports current surface and isolates every legacy symbol under diagnostic", () => {
    for (const name of [
      "legacySchemaDefinitions",
      "recoveryFenceCurrentPath",
      "recoveryLaunchPath",
      "validateRecoveryAuthorizationAttachment",
      "validateRecoveryLaunchTransition",
    ])
      expect(publicApi).not.toHaveProperty(name);
    expect(publicApi.diagnostic).toBe(diagnostic);
    expect(Object.keys(diagnostic).sort()).toEqual(
      ["parseContract", "paths", "schemaDefinitions", "schemaVersions", "validators"].sort(),
    );
    const manifest = JSON.parse(
      readFileSync(new URL("../../packages/contracts/package.json", import.meta.url), "utf8"),
    );
    expect(Object.keys(manifest.exports)).toEqual(["."]);
    expect(manifest.files).toEqual(["src"]);
  });

  test("removes superseded authority v1 from current dispatch and retains diagnostic parsing", () => {
    expect(diagnostic.schemaVersions).toHaveLength(13);
    for (const schemaVersion of diagnostic.schemaVersions) {
      const fixture = fixtureFor(schemaVersion);
      expect(schemaDefinitions).not.toHaveProperty(schemaVersion);
      expect(parseContract(schemaVersion, fixture)).toEqual({
        ok: false,
        issues: ["schemaVersion:unsupported"],
      });
      expect(diagnostic.parseContract(schemaVersion, fixture).ok, schemaVersion).toBe(true);
    }
    expect(diagnostic.parseContract("active-release/v2", fixtureFor("active-release/v2"))).toEqual({
      ok: false,
      issues: ["schemaVersion:not-diagnostic"],
    });
  });

  test("pins the complete current schema census and exhaustive closed-field parsing", () => {
    const required = [
      "pointer-current-tip/v1",
      "pointer-cas-proposal-receipt/v1",
      "pointer-conflict-receipt/v1",
      "pointer-tombstone-value/v1",
      "pointer-terminal-proof/v1",
      "pointer-archive-record/v1",
      "authority-retention/v1",
      "state-mutation-authority-value/v1",
      "active-release/v2",
      "activation-cleanup-gate-root/v2",
      "activation-cleanup-gate-head/v2",
      "activation-recovery-fence-root/v2",
      "activation-recovery-fence-head/v2",
      "activation-recovery-launch/v2",
      "recovery-attempt-reservation/v1",
      "recovery-attempt-descriptor/v1",
      "recovery-attempt-terminal-summary/v1",
      "recovery-attempt-accumulator/v1",
      "activation-cleanup-archive-head/v2",
      "recovery-authorization-core/v1",
      "recovery-authorization-state/v2",
      "native-consume-receipt/v1",
      "recovery-authorization-consume-receipt/v1",
      "native-removal-receipt/v1",
      "recovery-authorization-revoke-receipt/v1",
      "recovery-authorization-attachment/v1",
    ];
    for (const schemaVersion of required) expect(schemaVersions).toContain(schemaVersion);
    expect(schemaVersions).toHaveLength(51);
    expect(new Set(schemaVersions).size).toBe(schemaVersions.length);
    for (const schemaVersion of schemaVersions) {
      const fixture = fixtureFor(schemaVersion);
      expect(parseContract(schemaVersion, fixture).ok, schemaVersion).toBe(true);
      for (const [name, rule] of Object.entries(schemaDefinitions[schemaVersion]!.fields)) {
        const missing = { ...fixture } as Record<string, unknown>;
        delete missing[name];
        expect(parseContract(schemaVersion, missing).ok, `${schemaVersion}:${name}:missing`).toBe(
          false,
        );
        expect(
          parseContract(schemaVersion, { ...fixture, [name]: invalidFor(rule) }).ok,
          `${schemaVersion}:${name}:invalid`,
        ).toBe(false);
      }
      expect(parseContract(schemaVersion, { ...fixture, extraAuthority: digest }).ok).toBe(false);
    }
  });
});

describe("closed snapshots and canonical bytes", () => {
  test("accepts exact mutable, sealed, and frozen arrays", () => {
    for (const input of [["a"], Object.seal(["a"]), Object.freeze(["a"])]) {
      const result = snapshotClosedArray(input);
      expect(result.ok).toBe(true);
      if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
    }
  });

  test("refuses reflective array and record mutants without invoking user code", () => {
    const accessor = ["a"];
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get() {
        throw new Error("must not run");
      },
    });
    const extra = ["a"] as unknown[] & { extra?: string };
    extra.extra = "x";
    const symbol = ["a"];
    Object.defineProperty(symbol, Symbol("x"), { value: true });
    const hole = new Array(1);
    const subclass = new (class extends Array<string> {})("a");
    const proxy = new Proxy(["a"], {});
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    for (const input of [
      accessor,
      extra,
      symbol,
      hole,
      subclass,
      proxy,
      cyclic,
      Object.create(null),
    ])
      expect(snapshotClosedArray(input).ok).toBe(false);
    const fixture = fixtureFor("pointer-current-tip/v1");
    for (const input of [
      new Proxy(fixture, {}),
      Object.assign(Object.create({ x: 1 }), fixture),
      Object.defineProperty({ ...fixture }, "hidden", { value: 1 }),
    ])
      expect(parseContract("pointer-current-tip/v1", input).ok).toBe(false);
    const nullPrototype = Object.assign(Object.create(null), fixture);
    expect(parseContract("pointer-current-tip/v1", nullPrototype).ok).toBe(true);
  });

  test("canonical parse is exact-byte and total", () => {
    const fixture = fixtureFor("pointer-current-tip/v1");
    const serialized = serializeContract("pointer-current-tip/v1", fixture);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    expect(parseCanonicalContractBytes("pointer-current-tip/v1", serialized.bytes).ok).toBe(true);
    expect(
      parseCanonicalContractBytes(
        "pointer-current-tip/v1",
        new TextEncoder().encode(JSON.stringify(fixture)),
      ).ok,
    ).toBe(false);
    expect(() => canonicalBytes(new Proxy(fixture, {}) as never)).toThrow();
  });
});

describe("framed pointer digest graph", () => {
  const value = fixtureFor("active-release/v2");
  const activePosition = derivePointerPositionEvidence("ACTIVE_RELEASE", value);
  const activePositionDigest = computePointerPositionDigest("ACTIVE_RELEASE", activePosition);
  const mutationInput = {
    pointerKind: "ACTIVE_RELEASE" as const,
    canonicalPointerPath: "installation/active-release.json",
    pathInstanceDigest: digest,
    transactionId: uuid,
    sourceToken: "none",
    positionEvidence: activePosition,
    priorDt: null,
    priorDv: null,
    priorDr: null,
    successorDv: digest2,
    outcome: "SELECT",
    intent: "VALUE_PROPOSED",
  };

  test("pins exact domain-separated golden digests", () => {
    const dp = computePointerInstanceDigest({
      pointerKind: "ACTIVE_RELEASE",
      canonicalPointerPath: "installation/active-release.json",
      installationId: uuid,
      projectId: uuid,
      stateRootDigest: digest,
      transactionId: uuid,
      sourceToken: "none",
    });
    const mutationId = computeMutationId(mutationInput);
    const dv = computePointerValueDigest("ACTIVE_RELEASE", digest, value);
    const receipt = {
      ...fixtureFor("pointer-cas-proposal-receipt/v1"),
      pointerKind: "ACTIVE_RELEASE",
      pathInstanceDigest: digest,
      mutationId,
      priorTipDigest: null,
      priorValueDigest: null,
      priorReceiptDigest: null,
      successorValueDigest: dv,
      positionDigest: activePositionDigest,
      intent: "VALUE_PROPOSED",
      outcome: "SELECT",
    };
    const dr = computeProposalReceiptDigest({
      pointerKind: "ACTIVE_RELEASE",
      pathInstanceDigest: digest,
      mutationId,
      priorDt: null,
      priorDv: null,
      priorDr: null,
      successorDv: dv,
      positionDigest: activePositionDigest,
      intent: "VALUE_PROPOSED",
      outcome: "SELECT",
      receipt,
    });
    const tip = {
      ...fixtureFor("pointer-current-tip/v1"),
      pointerKind: "ACTIVE_RELEASE",
      pathInstanceDigest: digest,
      valueDigest: dv,
      proposalReceiptDigest: dr,
    };
    const dt = computeCurrentTipDigest("ACTIVE_RELEASE", digest, dv, dr, tip);
    const conflictReceipt = {
      ...fixtureFor("pointer-conflict-receipt/v1"),
      pathInstanceDigest: digest,
      mutationId,
      losingProposalReceiptDigest: dr,
      losingSuccessorValueDigest: dv,
      winningTipDigest: digest2,
      winningValueDigest: digest2,
      winningReceiptDigest: digest2,
      conflictKind: "VALUE_CONFLICT",
      authorityEpochTipDigest: digest,
      authorityEpochValueDigest: digest,
      authorityEpochReceiptDigest: digest,
      conflictAt: instant,
    };
    const dc = computeConflictDigest({
      pathInstanceDigest: digest,
      mutationId,
      losingDr: dr,
      losingDv: dv,
      winningDt: digest2,
      winningDv: digest2,
      winningDr: digest2,
      conflictKind: "VALUE_CONFLICT",
      authorityEpochDt: digest,
      authorityEpochDv: digest,
      authorityEpochDr: digest,
      conflictAt: instant,
      receipt: conflictReceipt,
    });
    expect({ dp, mutationId, dv, dr, dt, dc }).toEqual({
      dp: "89a284193336e4f6b301304ea99455dfec97eb958dd87f8377fc2fb0f9d40ef5",
      mutationId: "afb604950667cd9f27ad6bec7d495ca455a8e11f9368599108913df3c627d762",
      dv: "33a244faa7cb01fc8be0512b16abaa092eff6f382f3f07db3dbcafc114ce2473",
      dr: "4a5c3dbe0e5dc177bcdc637e674edb9ac871d0cc95e601f65206f75ac3d5d6b7",
      dt: "45570d8b34362bc9f95d6e6b124659d9ec5050ad183e14442170d92bf6189a38",
      dc: "e48b2b83dfca3a2c8e3b3057dfff19a3d62d942c0f63d9f730b89bea18d6457a",
    });
    expect(() =>
      computeProposalReceiptDigest({
        pointerKind: "ACTIVE_RELEASE",
        pathInstanceDigest: digest,
        mutationId,
        priorDt: null,
        priorDv: null,
        priorDr: null,
        successorDv: dv,
        positionDigest: digest2,
        intent: "VALUE_PROPOSED",
        outcome: "SELECT",
        receipt: { ...receipt, successorValueDigest: digest },
      }),
    ).toThrow(/binding-mismatch/);
    expect(() =>
      computeCurrentTipDigest("ACTIVE_RELEASE", digest, dv, dr, {
        ...tip,
        valueDigest: digest,
      }),
    ).toThrow(/binding-mismatch/);
    expect(() =>
      computeConflictDigest({
        pathInstanceDigest: digest,
        mutationId,
        losingDr: dr,
        losingDv: dv,
        winningDt: digest2,
        winningDv: digest2,
        winningDr: digest2,
        conflictKind: "VALUE_CONFLICT",
        authorityEpochDt: digest,
        authorityEpochDv: digest,
        authorityEpochDr: digest,
        conflictAt: instant,
        receipt: { ...conflictReceipt, winningTipDigest: digest },
      }),
    ).toThrow(/binding-mismatch/);
    expect(() =>
      computePointerValueDigest(
        "ACTIVE_RELEASE",
        digest,
        fixtureFor("activation-cleanup-gate-head/v2"),
      ),
    ).toThrow(/wrong-pointer-family/);
    expect(() => computeMutationId({ ...mutationInput, sourceToken: "future" })).toThrow(
      /sourceToken/,
    );
  });

  test("pins exact F bytes and all 26 canonical schema bytes", () => {
    const bytes = framedBytes("pointer-value/v2", [
      { type: "text", value: "A" },
      { type: "nullable-text", value: null },
      { type: "nullable-text", value: "B" },
      { type: "raw32", value: digest },
      { type: "nullable-raw32", value: null },
      { type: "nullable-raw32", value: digest2 },
      { type: "raw-fixed", value: "0001" },
      { type: "canonical", value: { a: 1 } },
    ]);
    expect(Buffer.from(bytes).toString("hex")).toBe(
      "6f726368657374726174696f6e2d706c6174666f726d00706f696e7465722d76616c75652f763200000000080100000000000000014106000000000000000007000000000000000142020000000000000020aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa030000000000000000040000000000000020bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb08000000000000000200010500000000000000087b2261223a317d0a",
    );
    expect(v2SchemaVersions).toHaveLength(26);
    const schemaBytes = v2SchemaVersions.map((schemaVersion) => ({
      digest: canonicalDigest(fixtureFor(schemaVersion)),
      schemaVersion,
    }));
    expect(canonicalDigest(schemaBytes)).toBe(
      "9759bad20bd258dfbfc6ee943fc626aae3c49b7c3e2495068c9410d29e589057",
    );
  });

  test("framing distinguishes null, text, raw, canonical, order, and domain", () => {
    const base = framedBytes("pointer-value/v2", [
      { type: "text", value: "x" },
      { type: "raw32", value: digest },
    ]);
    expect(base).not.toEqual(
      framedBytes("pointer-value/v2", [
        { type: "raw32", value: digest },
        { type: "text", value: "x" },
      ]),
    );
    expect(base).not.toEqual(
      framedBytes("pointer-tip/v2", [
        { type: "text", value: "x" },
        { type: "raw32", value: digest },
      ]),
    );
    expect(framedBytes("pointer-value/v2", [{ type: "nullable-raw32", value: null }])).not.toEqual(
      framedBytes("pointer-value/v2", [{ type: "text", value: "null" }]),
    );
    expect(() => framedBytes("pointer-value/v2", new Proxy([], {}))).toThrow(/array/);
    expect(() => framedBytes("pointer-value/v2", [{ type: "raw-fixed", value: "0" }])).toThrow(
      /raw-fixed/,
    );
    expect(() => framedBytes("pointer-value/v2", [{ type: "text", value: 1 } as never])).toThrow(
      /text/,
    );
    const dpInput = {
      pointerKind: "ACTIVE_RELEASE" as const,
      canonicalPointerPath: "installation/active-release.json",
      installationId: uuid,
      projectId: uuid,
      stateRootDigest: digest,
      transactionId: uuid,
      sourceToken: "none",
    };
    const activeDp = computePointerInstanceDigest(dpInput);
    expect(activeDp).not.toBe(computePointerInstanceDigest({ ...dpInput, transactionId: uuid2 }));
    expect(() => computePointerInstanceDigest({ ...dpInput, transactionId: null })).toThrow(
      /transactionId/,
    );
    expect(() => computePointerInstanceDigest({ ...dpInput, extra: true } as never)).toThrow(
      /unknown-field/,
    );
    expect(() => computePointerInstanceDigest({ ...dpInput, transactionId: "null" })).toThrow(
      /transactionId/,
    );
    const launchPath = pointerPath("ACTIVATION_RECOVERY_LAUNCH", {
      transactionId: uuid,
      sourceToken: "recovery-fence-v2",
    });
    for (const bindings of [
      { transactionId: uuid2, sourceToken: "recovery-fence-v2" },
      { transactionId: uuid, sourceToken: "cleanup-gate-pre-fence-v2" },
    ])
      expect(() =>
        computePointerInstanceDigest({
          ...dpInput,
          pointerKind: "ACTIVATION_RECOVERY_LAUNCH",
          canonicalPointerPath: launchPath,
          ...bindings,
        }),
      ).toThrow(/canonicalPointerPath/);
    const reservationPath = pointerPath("RECOVERY_ATTEMPT_RESERVATION", {
      transactionId: uuid,
      sourceToken: "recovery-fence-v2",
      predecessorKey: digest,
    });
    const reservationDpInput = {
      ...dpInput,
      pointerKind: "RECOVERY_ATTEMPT_RESERVATION" as const,
      canonicalPointerPath: reservationPath,
      transactionId: uuid,
      sourceToken: "recovery-fence-v2",
      predecessorKey: digest,
    };
    expect(() => computePointerInstanceDigest(reservationDpInput)).not.toThrow();
    const { predecessorKey: omittedPredecessor, ...withoutPredecessor } = reservationDpInput;
    expect(omittedPredecessor).toBe(digest);
    expect(() => computePointerInstanceDigest(withoutPredecessor as never)).toThrow(/missing/);
    expect(() =>
      computePointerInstanceDigest({ ...reservationDpInput, predecessorKey: null } as never),
    ).toThrow(/predecessorKey/);
  });

  test("binds every tombstone selection to its family, archive, proof, and non-genesis prior", () => {
    const enabled = pointerRegistry.filter((row) =>
      row.valueSchemas.includes("pointer-tombstone-value/v1"),
    );
    expect(enabled).toHaveLength(9);
    const census: JsonValue[] = [];
    for (const row of enabled) {
      expect(row.tombstonePositionDomain).toBe(`${row.positionDomain.slice(0, -3)}-tombstone/v1`);
      const ordinaryValue = fixtureFor(row.valueSchemas[0]!);
      const ordinaryTransactionId = row.transactionPolicy === "REQUIRED" ? uuid : null;
      const ordinarySourceToken = row.sourceTokens[0]!;
      const ordinaryPathBindings: Record<string, string> = {
        ...(row.pathTemplate.includes("<transaction>") ? { transactionId: uuid } : {}),
        ...(row.pathTemplate.includes("<source>") ? { sourceToken: ordinarySourceToken } : {}),
        ...(row.pathTemplate.includes("<predecessor-key>")
          ? {
              predecessorKey: computeReservationPredecessorKey({
                transactionId: uuid,
                sourceToken: ordinarySourceToken,
                priorDt: ordinaryValue.predecessorAccumulatorTipDigest,
                priorDv: ordinaryValue.predecessorAccumulatorValueDigest,
                priorDr: ordinaryValue.predecessorAccumulatorReceiptDigest,
              }),
            }
          : {}),
      };
      for (const intent of ["VALUE_PROPOSED", "TOMBSTONE_PROPOSED"] as const)
        for (const outcome of ["SELECT", "REMOVE"] as const) {
          const ordinary = pointerSelection(row.kind, ordinaryValue, {
            pathBindings: ordinaryPathBindings,
            transactionId: ordinaryTransactionId,
            sourceToken: ordinarySourceToken,
            intent,
            outcome,
          });
          const issues = validateSelectedPointerEvidence(ordinary.envelope);
          if (intent === "VALUE_PROPOSED" && outcome === "SELECT")
            expect(issues, `${row.kind}:ordinary:${intent}:${outcome}`).toEqual([]);
          else expect(issues, `${row.kind}:ordinary:${intent}:${outcome}`).not.toEqual([]);
        }
      const selected = tombstoneSelection(row);
      expect(validateSelectedPointerEvidence(selected.envelope), row.kind).toEqual([]);
      const tombstone = selected.envelope.value as ContractRecord;
      const position = selected.envelope.positionEvidence as ContractRecord;
      expect(position.variant).toBe("TOMBSTONE");
      expect(validatePointerPositionEvidence(row.kind, position)).toEqual([]);
      for (const field of pointerPositionContracts[row.kind].tombstoneFields ?? [])
        for (const malformed of [null, "a", digest.toUpperCase(), 1])
          expect(
            validatePointerPositionEvidence(row.kind, { ...position, [field]: malformed }),
            `${row.kind}:tombstone:${field}:${malformed}`,
          ).not.toEqual([]);
      expect(() => computePointerPositionDigest(row.kind, position)).not.toThrow();
      census.push({
        kind: row.kind,
        positionDigest: computePointerPositionDigest(row.kind, position),
        proposalReceiptDigest: selected.proposalReceiptDigest,
        tipDigest: selected.tipDigest,
        valueDigest: selected.valueDigest,
      });
      for (const intent of ["VALUE_PROPOSED", "TOMBSTONE_PROPOSED"] as const)
        for (const outcome of ["SELECT", "REMOVE"] as const) {
          const coordinated = pointerSelection(row.kind, tombstone, {
            pathBindings: selected.envelope.pathBindings as Record<string, string>,
            transactionId: selected.envelope.transactionId as string,
            sourceToken: selected.envelope.sourceToken as string,
            prior: {
              tipDigest: selected.proposal.priorTipDigest as string,
              valueDigest: selected.proposal.priorValueDigest as string,
              proposalReceiptDigest: selected.proposal.priorReceiptDigest as string,
            },
            tombstoneEvidence: selected.envelope.tombstoneEvidence as ContractRecord,
            intent,
            outcome,
          });
          const issues = validateSelectedPointerEvidence(coordinated.envelope);
          if (intent === "TOMBSTONE_PROPOSED" && outcome === "REMOVE")
            expect(issues, `${row.kind}:${intent}:${outcome}`).toEqual([]);
          else expect(issues, `${row.kind}:${intent}:${outcome}`).not.toEqual([]);
        }
      for (const other of pointerKinds.filter((kind) => kind !== row.kind))
        expect(() =>
          computePointerValueDigest(row.kind, digest, { ...tombstone, pointerKind: other }),
        ).toThrow(/tombstone-dispatch/);
      for (const priorField of ["priorTipDigest", "priorValueDigest", "priorReceiptDigest"])
        expect(
          validateSelectedPointerEvidence({
            ...selected.envelope,
            value: {
              ...tombstone,
              [priorField]: tombstone[priorField] === digest ? digest2 : digest,
            },
          }),
          `${row.kind}:${priorField}`,
        ).not.toEqual([]);
      const evidence = selected.envelope.tombstoneEvidence as ContractRecord;
      const archiveRecord = evidence.archiveRecord as ContractRecord;
      const terminalProof = evidence.terminalProof as ContractRecord;
      const priorSelection = evidence.priorSelection as ContractRecord;
      if (!["ACTIVE_RELEASE", "ACTIVATION_CLEANUP_ARCHIVE_HEAD"].includes(row.kind))
        expect(
          validateSelectedPointerEvidence(tombstoneSelection(row, ordinarySelection(row)).envelope),
          `${row.kind}:nonterminal-prior`,
        ).not.toEqual([]);
      for (const [field, replacement] of [
        ["canonicalPointerPath", "alias.json"],
        ["installationId", uuid2],
        ["projectId", uuid2],
        ["stateRootDigest", digest2],
        ["transactionId", uuid2],
        ["sourceToken", priorSelection.sourceToken === "none" ? "recovery-fence-v2" : "none"],
      ] as const)
        expect(
          validateSelectedPointerEvidence({
            ...selected.envelope,
            tombstoneEvidence: {
              ...evidence,
              priorSelection: { ...priorSelection, [field]: replacement },
            },
          }),
          `${row.kind}:prior:${field}`,
        ).not.toEqual([]);
      for (const identities of [
        { installationId: uuid2 },
        { projectId: uuid2 },
        { stateRootDigest: digest2 },
      ])
        expect(
          validateSelectedPointerEvidence(
            tombstoneSelection(row, ordinarySelection(row, identities, true)).envelope,
          ),
          `${row.kind}:coordinated-prior-identity`,
        ).not.toEqual([]);
      for (const mutant of [
        { ...evidence, archivePath: `${evidence.archivePath as string}alias` },
        ...(Object.keys(evidence.archiveBindings as ContractRecord).length > 0
          ? [{ ...evidence, archiveBindings: {} }]
          : []),
        { ...evidence, archiveRecord: { ...archiveRecord, archivePath: "archive/alias.json" } },
        { ...evidence, archiveRecord: { ...archiveRecord, terminalProofDigest: digest } },
        { ...evidence, archiveRecord: { ...archiveRecord, canonicalPointerPath: "alias.json" } },
        { ...evidence, archiveRecord: { ...archiveRecord, transactionId: uuid2 } },
        {
          ...evidence,
          archiveRecord: {
            ...archiveRecord,
            sourceToken: archiveRecord.sourceToken === "none" ? "recovery-fence-v2" : "none",
          },
        },
        { ...evidence, archiveRecord: { ...archiveRecord, priorValueDigest: digest } },
        { ...evidence, archiveRecord: { ...archiveRecord, installationId: uuid2 } },
        { ...evidence, archiveRecord: { ...archiveRecord, projectId: uuid2 } },
        { ...evidence, archiveRecord: { ...archiveRecord, stateRootDigest: digest2 } },
        { ...evidence, archiveRecord: { ...archiveRecord, pathInstanceDigest: digest2 } },
        { ...evidence, archiveRecord: { ...archiveRecord, priorPositionDigest: digest2 } },
        {
          ...evidence,
          archiveRecord: { ...archiveRecord, priorAuthorityEpochTipDigest: digest2 },
        },
        {
          ...evidence,
          archiveRecord: { ...archiveRecord, priorValueSchemaVersion: "future-value/v1" },
        },
        { ...evidence, terminalProof: { ...terminalProof, terminalTipDigest: digest2 } },
        { ...evidence, terminalProof: { ...terminalProof, pointerKind: "AUTHORITY_RETENTION" } },
        { ...evidence, terminalProof: { ...terminalProof, canonicalPointerPath: "alias.json" } },
        { ...evidence, terminalProof: { ...terminalProof, transactionId: uuid2 } },
        { ...evidence, terminalProof: { ...terminalProof, installationId: uuid2 } },
        { ...evidence, terminalProof: { ...terminalProof, projectId: uuid2 } },
        { ...evidence, terminalProof: { ...terminalProof, stateRootDigest: digest2 } },
        { ...evidence, terminalProof: { ...terminalProof, pathInstanceDigest: digest2 } },
        { ...evidence, terminalProof: { ...terminalProof, terminalPositionDigest: digest2 } },
        {
          ...evidence,
          terminalProof: { ...terminalProof, priorAuthorityEpochReceiptDigest: digest2 },
        },
        {
          ...evidence,
          terminalProof: { ...terminalProof, terminalValueSchemaVersion: "future-value/v1" },
        },
        {
          ...evidence,
          terminalProof: {
            ...terminalProof,
            sourceToken: terminalProof.sourceToken === "none" ? "recovery-fence-v2" : "none",
          },
        },
        { ...evidence, terminalProof: { ...terminalProof, authorityEpochTipDigest: digest2 } },
      ])
        expect(
          validateSelectedPointerEvidence({ ...selected.envelope, tombstoneEvidence: mutant }),
          row.kind,
        ).not.toEqual([]);
      expect(
        validateSelectedPointerEvidence({
          ...selected.envelope,
          proposal: {
            ...selected.proposal,
            priorTipDigest: null,
            priorValueDigest: null,
            priorReceiptDigest: null,
          },
        }),
      ).not.toEqual([]);
      const otherRow = enabled.find((candidate) => candidate.kind !== row.kind)!;
      expect(() => computePointerPositionDigest(otherRow.kind, position)).toThrow();
    }
    expect(canonicalDigest(census)).toBe(
      "87cbf77496b44eb987a0d15488f76bbdbb8217c60b48cd2406fbc990c894170d",
    );
  });

  test("pins reservation predecessor keys to transaction, source, tag, and ordered triple", () => {
    const genesis = computeReservationPredecessorKey({
      transactionId: uuid,
      sourceToken: "recovery-fence-v2",
      priorDt: null,
      priorDv: null,
      priorDr: null,
    });
    const later = computeReservationPredecessorKey({
      transactionId: uuid,
      sourceToken: "recovery-fence-v2",
      priorDt: digest,
      priorDv: digest2,
      priorDr: digest,
    });
    expect({ genesis, later }).toEqual({
      genesis: "0c8f4a3d54a48bad7fd6f0adf8bde4ae2009d2ced6f4f85c6b4415abd9a4da46",
      later: "e64f65df7f718ffa7df635dee402626477270b55daeed0a0224d105fb49df3a7",
    });
    expect(genesis).not.toBe(later);
    expect(() =>
      computeReservationPredecessorKey({
        transactionId: uuid,
        sourceToken: "recovery-fence-v2",
        priorDt: digest,
        priorDv: null,
        priorDr: null,
      }),
    ).toThrow(/partial/);
    expect(later).not.toBe(
      computeReservationPredecessorKey({
        transactionId: uuid,
        sourceToken: "recovery-fence-v2",
        priorDt: digest2,
        priorDv: digest,
        priorDr: digest,
      }),
    );
    expect(later).not.toBe(
      computeReservationPredecessorKey({
        transactionId: uuid2,
        sourceToken: "recovery-fence-v2",
        priorDt: digest,
        priorDv: digest2,
        priorDr: digest,
      }),
    );
  });
});

describe("pointer, cleanup, epoch, authorization, and attempt semantics", () => {
  test("classifies proposals only from exact evidence", () => {
    const base = {
      checkpointSelected: false,
      compacted: false,
      completionSelected: false,
      conflictMatchesWinner: false,
      malformed: false,
      pending: true,
      planSelected: false,
      selectedTipMatches: false,
    };
    expect(classifyProposal(base)).toBe("PENDING");
    expect(classifyProposal({ ...base, pending: false, selectedTipMatches: true })).toBe(
      "SELECTED",
    );
    expect(classifyProposal({ ...base, pending: false, conflictMatchesWinner: true })).toBe(
      "LOST_CONFLICT",
    );
    expect(
      classifyProposal({
        ...base,
        pending: false,
        compacted: true,
        checkpointSelected: true,
        planSelected: true,
        completionSelected: true,
      }),
    ).toBe("COMPACTED");
    expect(classifyProposal({ ...base, selectedTipMatches: true })).toBe("UNKNOWN");
    expect(
      classifyProposal({
        ...base,
        pending: false,
        selectedTipMatches: true,
        conflictMatchesWinner: true,
      }),
    ).toBe("UNKNOWN");
    expect(classifyProposal({ ...base, pending: false, compacted: true })).toBe("UNKNOWN");
    expect(classifyProposal({ ...base, malformed: true })).toBe("UNKNOWN");
    expect(
      classifyProposal({ ...base, malformed: "false", pending: false, selectedTipMatches: true }),
    ).toBe("UNKNOWN");
    expect(classifyProposal({ ...base, extra: true })).toBe("UNKNOWN");
  });

  test("pins ten cleanup pairs, twelve edges, and no append self loops", () => {
    const lifecycles = ["PENDING", "ACTIVATING", "ABORTING", "COMPLETE"];
    const publications = ["NOT_PUBLISHED", "PUBLISHING", "PUBLISHED", "CLEARED"];
    const pairs = lifecycles.flatMap((lifecycle) =>
      publications.map((publication) => [lifecycle, publication] as const),
    );
    expect(
      pairs.filter(([lifecycle, publication]) =>
        isCleanupLifecyclePublicationPair(lifecycle, publication),
      ),
    ).toHaveLength(10);
    let edges = 0;
    for (const [a, b] of pairs)
      for (const [c, d] of pairs)
        if (isCleanupLifecyclePublicationTransition(a, b, c, d)) edges += 1;
    expect(edges).toBe(12);
    for (const [lifecycle, publication] of pairs)
      if (isCleanupLifecyclePublicationPair(lifecycle, publication))
        expect(reduceCleanupHeadWrite(lifecycle, publication, lifecycle, publication)).toBe(
          "NO_APPEND",
        );
  });

  test("pins ordinary epoch ordering and complete other-kind rotation census", () => {
    const epochSequence = ordinaryEpochSequence.map((step) => ({
      step,
      authorityEpochDigest: digest,
      authorityEpochTipDigest: digest2,
      authorityEpochValueDigest: digest,
      authorityEpochReceiptDigest: digest2,
    }));
    expect(validateEpochSequence(epochSequence)).toBe(true);
    expect(validateEpochSequence([...epochSequence].reverse())).toBe(false);
    expect(
      validateEpochSequence(
        epochSequence.map((entry, index) =>
          index === 5 ? { ...entry, authorityEpochTipDigest: digest } : entry,
        ),
      ),
    ).toBe(false);
    expect(validateEpochSequence([...ordinaryEpochSequence])).toBe(false);
    const entries = pointerKinds
      .filter((kind) => kind !== "STATE_MUTATION_AUTHORITY_ROTATION")
      .sort()
      .map((pointerKind) => ({
        classification: "SELECTED",
        pathInstanceDigest: digest,
        pointerKind,
        proposalReceiptDigest: digest,
        tipDigest: digest,
        valueDigest: digest,
      }));
    const census = { authorityEpochDigest: digest, entries };
    expect(validateRotationCensus(census)).toBe(true);
    expect(
      validateRotationCensus({
        ...census,
        entries: entries.map((entry, index) =>
          index === 0 ? { ...entry, classification: "PENDING" } : entry,
        ),
      }),
    ).toBe(false);
    expect(validateRotationCensus({ ...census, entries: entries.slice(1) })).toBe(false);
    expect(validateRotationCensus({ ...census, entries: [...entries].reverse() })).toBe(false);
    expect(validateRotationCensus({ ...census, entries: [...entries, entries.at(-1)!] })).toBe(
      false,
    );

    const genesis = fixtureFor("state-mutation-authority-value/v1");
    expect(parseContract("state-mutation-authority-value/v1", genesis).ok).toBe(true);
    const rotation = {
      ...genesis,
      rotationKind: "ROTATION",
      producerKind: "SELECTED_STABLE",
      priorAuthorityTipDigest: digest,
      priorAuthorityValueDigest: digest,
      priorAuthorityReceiptDigest: digest,
      priorHelperDigest: digest,
      priorHelperProfileDigest: digest,
      priorHelperAbiDigest: digest,
      priorCustodyReceiptDigest: digest,
    };
    expect(parseContract("state-mutation-authority-value/v1", rotation).ok).toBe(true);
    expect(
      parseContract("state-mutation-authority-value/v1", {
        ...rotation,
        priorHelperDigest: null,
      }).ok,
    ).toBe(false);
  });

  test("validates ordered cleanup/fence histories and retention policy", () => {
    const gate0 = fixtureFor("activation-cleanup-gate-head/v2");
    const gate1 = {
      ...gate0,
      ordinal: 1,
      previousHeadDigest: serializeContract("activation-cleanup-gate-head/v2", gate0).ok
        ? (
            serializeContract("activation-cleanup-gate-head/v2", gate0) as {
              ok: true;
              digest: string;
            }
          ).digest
        : digest,
      publication: "PUBLISHING",
      fenceDigest: digest,
    };
    expect(validateCleanupHeadHistory([gate0, gate1])).toEqual([]);
    expect(validateCleanupHeadHistory([gate1, gate0])).not.toEqual([]);
    const fence0 = fixtureFor("activation-recovery-fence-head/v2");
    const fenceDigest = (
      serializeContract("activation-recovery-fence-head/v2", fence0) as { ok: true; digest: string }
    ).digest;
    const fence1 = {
      ...fence0,
      ordinal: 1,
      previousHeadDigest: fenceDigest,
      lifecycle: "POST_ACTIVATION",
    };
    expect(validateFenceHeadHistory([fence0, fence1])).toEqual([]);
    expect(validateFenceHeadHistory([fence1])).not.toEqual([]);
    const retention = {
      checkpointDigest: digest,
      completionReceiptDigest: null,
      lossProofDigest: null,
      nextPhase: "CHECKPOINTED",
      planDigest: null,
      previousPhase: "CURRENT",
      proposalClassification: "SELECTED",
      recordClass: "TERMINAL_ATTEMPT_HISTORY",
    };
    expect(validateRetentionTransition(retention)).toBe(true);
    expect(validateRetentionTransition({ ...retention, proposalClassification: "PENDING" })).toBe(
      false,
    );
    expect(validateRetentionTransition({ ...retention, checkpointDigest: "not-a-digest" })).toBe(
      false,
    );
    expect(retentionAllows("AUDIT_DEGRADED", "EXISTING_RECOVERY")).toBe(true);
    expect(retentionAllows("AUDIT_DEGRADED", "NEW_PROMOTION")).toBe(false);
    expect(retentionAllows("UNKNOWN", "EXISTING_RECOVERY")).toBe(false);

    const cleanupBase = fixtureFor("activation-cleanup-gate-head/v2");
    const admissible = [
      ["PENDING", "NOT_PUBLISHED"],
      ["PENDING", "PUBLISHING"],
      ["PENDING", "PUBLISHED"],
      ["ACTIVATING", "PUBLISHED"],
      ["ABORTING", "NOT_PUBLISHED"],
      ["ABORTING", "PUBLISHING"],
      ["ABORTING", "PUBLISHED"],
      ["ABORTING", "CLEARED"],
      ["COMPLETE", "NOT_PUBLISHED"],
      ["COMPLETE", "CLEARED"],
    ] as const;
    for (const [lifecycle, publication] of admissible) {
      const complete = lifecycle === "COMPLETE";
      const needsFence = publication === "PUBLISHING" || publication === "PUBLISHED";
      expect(
        parseContract("activation-cleanup-gate-head/v2", {
          ...cleanupBase,
          lifecycle,
          publication,
          fenceDigest: needsFence ? digest : null,
          terminalRevocationReceiptDigest: complete ? digest : null,
          terminalProofDigest: complete ? digest : null,
          archiveOutcomeDigest: complete ? digest : null,
        }).ok,
        `${lifecycle}/${publication}`,
      ).toBe(true);
    }
  });

  test("auth core forbids candidate manifest and pins mode/state evidence", () => {
    const core = fixtureFor("recovery-authorization-core/v1");
    expect(parseContract("recovery-authorization-core/v1", core).ok).toBe(true);
    const successorCore = {
      ...core,
      mode: "SUCCESSOR",
      grantDigest: null,
      installerDigest: null,
      destinationDigest: null,
      cycleId: uuid,
      admissionDigest: digest,
      priorBrokerGeneration: 0,
      successorBrokerGeneration: 1,
      expectedActiveGeneration: 0,
      predecessorReleaseDigest: digest,
      successorReleaseDigest: digest2,
      predecessorExecutableDigest: digest,
      successorExecutableDigest: digest2,
      predecessorOperationManifestDigest: digest,
      successorOperationManifestDigest: digest2,
      fencePath: "installation/fence.json",
      fenceDigest: digest,
    };
    expect(parseContract("recovery-authorization-core/v1", successorCore).ok).toBe(true);
    expect(
      parseContract("recovery-authorization-core/v1", {
        ...successorCore,
        successorBrokerGeneration: 2,
      }).ok,
    ).toBe(false);
    expect(
      parseContract("recovery-authorization-core/v1", { ...core, expiresAt: instant }).ok,
    ).toBe(false);
    expect(
      parseContract("recovery-authorization-core/v1", {
        ...core,
        candidateOperationManifestDigest: digest,
      }).ok,
    ).toBe(false);
    expect(parseContract("recovery-authorization-core/v1", { ...core, grantDigest: null }).ok).toBe(
      false,
    );
    const state = fixtureFor("recovery-authorization-state/v2");
    expect(parseContract("recovery-authorization-state/v2", state).ok).toBe(true);
    expect(
      parseContract("recovery-authorization-state/v2", { ...state, lifecycle: "CONSUMED" }).ok,
    ).toBe(false);
    expect(
      parseContract("recovery-authorization-state/v2", {
        ...state,
        lifecycle: "CONSUMED",
        gateRootDigest: digest,
        nativeConsumeReceiptDigest: digest,
      }).ok,
    ).toBe(true);

    const coreDigest = computeRecoveryAuthorizationCoreDigest(core);
    expect(coreDigest).not.toBe(canonicalDigest(core));
    expect(coreDigest).toBe("407acdd929de14c74ee29274c7b2f6322a16f4603fa3450d1831172dc049fafd");
    const createdState = { ...state, coreDigest };
    const createdSelection = authorizationSelection(core, createdState);
    const gateRoot: ContractRecord = {
      ...fixtureFor("activation-cleanup-gate-root/v2"),
      authorizationCoreDigest: coreDigest,
      authorizationCreatedTipDigest: createdSelection.tipDigest,
      authorizationCreatedValueDigest: createdSelection.valueDigest,
      authorizationCreatedReceiptDigest: createdSelection.proposalReceiptDigest,
    };
    const gateRootDigest = canonicalDigest(gateRoot);
    const nativeConsume = {
      ...fixtureFor("native-consume-receipt/v1"),
      coreDigest,
    };
    const nativeConsumeDigest = canonicalDigest(nativeConsume);
    const consumedStateBase = {
      ...state,
      coreDigest,
      lifecycle: "CONSUMED",
      gateRootDigest,
      nativeConsumeReceiptDigest: nativeConsumeDigest,
    };
    const consumedSelection = authorizationSelection(core, consumedStateBase, createdSelection);
    const postConsume: ContractRecord = {
      ...fixtureFor("recovery-authorization-consume-receipt/v1"),
      authorizationTipDigest: consumedSelection.tipDigest,
      authorizationValueDigest: consumedSelection.valueDigest,
      authorizationReceiptDigest: consumedSelection.proposalReceiptDigest,
      nativeConsumeReceiptDigest: nativeConsumeDigest,
      coreDigest,
      gateRootDigest,
      selectedReadbackDigest: consumedSelection.tipDigest,
    };
    const consumedState = consumedStateBase;
    const consumeEnvelope = {
      core,
      createdProposal: createdSelection.proposal,
      createdState,
      createdTip: createdSelection.tip,
      gateRoot,
      nativeConsume,
      postConsume,
      selectedProposal: consumedSelection.proposal,
      selectedTip: consumedSelection.tip,
      state: consumedState,
    };
    expect(validateAuthorizationReceiptChain(consumeEnvelope)).toEqual([]);
    expect(
      validateAuthorizationReceiptChain({
        ...consumeEnvelope,
        nativeConsume: {
          ...nativeConsume,
          operationId: "018f0c24-7a3b-7cc1-9a2f-1234567890ac",
        },
      }),
    ).not.toEqual([]);
    const wrongPredecessorSelection = authorizationSelection(core, consumedState, {
      tipDigest: digest,
      valueDigest: digest2,
      proposalReceiptDigest: digest,
    });
    expect(
      validateAuthorizationReceiptChain({
        ...consumeEnvelope,
        selectedProposal: wrongPredecessorSelection.proposal,
        selectedTip: wrongPredecessorSelection.tip,
        postConsume: {
          ...postConsume,
          authorizationTipDigest: wrongPredecessorSelection.tipDigest,
          authorizationValueDigest: wrongPredecessorSelection.valueDigest,
          authorizationReceiptDigest: wrongPredecessorSelection.proposalReceiptDigest,
          selectedReadbackDigest: wrongPredecessorSelection.tipDigest,
        },
      }),
    ).not.toEqual([]);
    expect(
      validateAuthorizationReceiptChain({
        ...consumeEnvelope,
        selectedProposal: { ...consumedSelection.proposal, positionDigest: digest },
      }),
    ).not.toEqual([]);
    expect(
      validateAuthorizationReceiptChain({
        ...consumeEnvelope,
        selectedTip: { ...consumedSelection.tip, valueDigest: digest },
      }),
    ).not.toEqual([]);
    for (const name of [
      "capabilityReferenceDigest",
      "capabilityDigest",
      "custodyPrincipalDigest",
      "brokerServiceDigest",
      "brokerProfileDigest",
      "nativeReadbackDigest",
    ] as const)
      expect(
        validateAuthorizationReceiptChain({
          ...consumeEnvelope,
          postConsume: { ...postConsume, [name]: digest2 },
        }),
        name,
      ).not.toEqual([]);

    expect(
      validateGateAuthorizationBinding({
        core,
        createdProposal: createdSelection.proposal,
        createdState,
        createdTip: createdSelection.tip,
        gateRoot,
      }),
    ).toEqual([]);
    const successorCoreDigest = computeRecoveryAuthorizationCoreDigest(successorCore);
    const successorCreatedState = { ...state, coreDigest: successorCoreDigest };
    const successorCreatedSelection = authorizationSelection(successorCore, successorCreatedState);
    const successorGateRoot = {
      ...gateRoot,
      mode: "SUCCESSOR",
      grantDigest: null,
      installerDigest: null,
      destinationDigest: null,
      cycleId: successorCore.cycleId,
      admissionDigest: successorCore.admissionDigest,
      priorBrokerGeneration: successorCore.priorBrokerGeneration,
      successorBrokerGeneration: successorCore.successorBrokerGeneration,
      expectedActiveGeneration: successorCore.expectedActiveGeneration,
      predecessorReleaseDigest: successorCore.predecessorReleaseDigest,
      successorReleaseDigest: successorCore.successorReleaseDigest,
      predecessorExecutableDigest: successorCore.predecessorExecutableDigest,
      successorExecutableDigest: successorCore.successorExecutableDigest,
      predecessorOperationManifestDigest: successorCore.predecessorOperationManifestDigest,
      successorOperationManifestDigest: successorCore.successorOperationManifestDigest,
      fencePath: successorCore.fencePath,
      expectedFenceRootDigest: successorCore.fenceDigest,
      expectedActiveReleaseDigest: successorCore.predecessorReleaseDigest,
      authorizationCoreDigest: successorCoreDigest,
      authorizationCreatedTipDigest: successorCreatedSelection.tipDigest,
      authorizationCreatedValueDigest: successorCreatedSelection.valueDigest,
      authorizationCreatedReceiptDigest: successorCreatedSelection.proposalReceiptDigest,
    };
    expect(
      validateGateAuthorizationBinding({
        core: successorCore,
        createdProposal: successorCreatedSelection.proposal,
        createdState: successorCreatedState,
        createdTip: successorCreatedSelection.tip,
        gateRoot: successorGateRoot,
      }),
    ).toEqual([]);
    expect(
      validateGateAuthorizationBinding({
        core,
        createdProposal: createdSelection.proposal,
        createdState,
        createdTip: createdSelection.tip,
        gateRoot: { ...gateRoot, projectId: "018f0c24-7a3b-7cc1-9a2f-1234567890ac" },
      }),
    ).not.toEqual([]);
    for (const name of [
      "mode",
      "candidateDigest",
      "grantDigest",
      "installerDigest",
      "destinationDigest",
      "cycleId",
      "admissionDigest",
      "priorBrokerGeneration",
      "successorBrokerGeneration",
      "expectedActiveGeneration",
      "predecessorReleaseDigest",
      "successorReleaseDigest",
      "predecessorExecutableDigest",
      "successorExecutableDigest",
      "predecessorOperationManifestDigest",
      "successorOperationManifestDigest",
      "fencePath",
      "expectedActiveReleaseDigest",
      "expectedFenceRootDigest",
    ] as const) {
      const original = gateRoot[name];
      const replacement =
        name === "mode"
          ? "SUCCESSOR"
          : name === "cycleId"
            ? uuid2
            : name.includes("Generation")
              ? 1
              : original === null || original === digest2
                ? digest
                : digest2;
      expect(
        validateGateAuthorizationBinding({
          core,
          createdProposal: createdSelection.proposal,
          createdState,
          createdTip: createdSelection.tip,
          gateRoot: { ...gateRoot, [name]: replacement },
        }),
        name,
      ).not.toEqual([]);
    }
    for (const name of [
      "authorizationCoreDigest",
      "authorizationCorePath",
      "authorizationCreatedTipDigest",
      "authorizationCreatedValueDigest",
      "authorizationCreatedReceiptDigest",
      "consumeOperationId",
      "nativeConsumeReceiptPath",
    ] as const)
      expect(
        validateGateAuthorizationBinding({
          core,
          createdProposal: createdSelection.proposal,
          createdState,
          createdTip: createdSelection.tip,
          gateRoot: {
            ...gateRoot,
            [name]: name.endsWith("Path")
              ? "wrong/path.json"
              : name === "consumeOperationId"
                ? "018f0c24-7a3b-7cc1-9a2f-1234567890ac"
                : gateRoot[name] === digest2
                  ? digest
                  : digest2,
          },
        }),
        name,
      ).not.toEqual([]);

    const nativeRemoval: ContractRecord = {
      ...fixtureFor("native-removal-receipt/v1"),
      nativeConsumeReceiptDigest: nativeConsumeDigest,
    };
    const revokedState = {
      ...consumedState,
      lifecycle: "REVOKED",
      nativeRemovalReceiptDigest: canonicalDigest(nativeRemoval),
    };
    const revokedSelection = authorizationSelection(core, revokedState, consumedSelection);
    const postRevoke: ContractRecord = {
      ...fixtureFor("recovery-authorization-revoke-receipt/v1"),
      authorizationTipDigest: revokedSelection.tipDigest,
      authorizationValueDigest: revokedSelection.valueDigest,
      authorizationReceiptDigest: revokedSelection.proposalReceiptDigest,
      nativeRemovalReceiptDigest: canonicalDigest(nativeRemoval),
      coreDigest,
      gateRootDigest,
      nativeAbsenceReadbackDigest: nativeRemoval.nativeAbsenceReadbackDigest as string,
      selectedReadbackDigest: revokedSelection.tipDigest,
    };
    expect(
      validateAuthorizationRevokeReceiptChain({
        consumedProposal: consumedSelection.proposal,
        consumedState,
        consumedTip: consumedSelection.tip,
        core,
        createdProposal: createdSelection.proposal,
        createdState,
        createdTip: createdSelection.tip,
        gateRoot,
        nativeConsume,
        nativeRemoval,
        postConsume,
        postRevoke,
        selectedProposal: revokedSelection.proposal,
        selectedTip: revokedSelection.tip,
        state: revokedState,
      }),
    ).toEqual([]);
    expect(
      validateAuthorizationRevokeReceiptChain({
        consumedProposal: consumedSelection.proposal,
        consumedState,
        consumedTip: consumedSelection.tip,
        core,
        createdProposal: createdSelection.proposal,
        createdState,
        createdTip: createdSelection.tip,
        gateRoot,
        nativeConsume,
        nativeRemoval: { ...nativeRemoval, nativeAbsenceReadbackDigest: digest2 },
        postConsume,
        postRevoke,
        selectedProposal: revokedSelection.proposal,
        selectedTip: revokedSelection.tip,
        state: revokedState,
      }),
    ).not.toEqual([]);
    const wrongRevokedSelection = authorizationSelection(core, revokedState, createdSelection);
    expect(
      validateAuthorizationRevokeReceiptChain({
        consumedProposal: consumedSelection.proposal,
        consumedState,
        consumedTip: consumedSelection.tip,
        core,
        createdProposal: createdSelection.proposal,
        createdState,
        createdTip: createdSelection.tip,
        gateRoot,
        nativeConsume,
        nativeRemoval,
        postConsume,
        postRevoke: {
          ...postRevoke,
          authorizationTipDigest: wrongRevokedSelection.tipDigest,
          authorizationValueDigest: wrongRevokedSelection.valueDigest,
          authorizationReceiptDigest: wrongRevokedSelection.proposalReceiptDigest,
          selectedReadbackDigest: wrongRevokedSelection.tipDigest,
        },
        selectedProposal: wrongRevokedSelection.proposal,
        selectedTip: wrongRevokedSelection.tip,
        state: revokedState,
      }),
    ).not.toEqual([]);

    const attachment = fixtureFor("recovery-authorization-attachment/v1");
    expect(parseContract("recovery-authorization-attachment/v1", attachment).ok).toBe(true);
    expect(
      parseContract("recovery-authorization-attachment/v1", {
        ...attachment,
        lifecycle: "ATTACHED",
      }).ok,
    ).toBe(false);
  });

  test("attempt groups, bounded packets, and rolling formulas fail closed", () => {
    const reservation = fixtureFor("recovery-attempt-reservation/v1");
    expect(
      parseContract("recovery-attempt-reservation/v1", {
        ...reservation,
        predecessorAccumulatorTipDigest: digest,
      }).ok,
    ).toBe(false);
    const descriptor = fixtureFor("recovery-attempt-descriptor/v1");
    expect(
      parseContract("recovery-attempt-descriptor/v1", { ...descriptor, lifecycle: "LIVE" }).ok,
    ).toBe(false);
    expect(recoveryAccumulatorDigest(null, digest)).not.toBe(
      recoveryAccumulatorDigest(digest2, digest),
    );
    const authorityEpoch = pointerSelection(
      "STATE_MUTATION_AUTHORITY_ROTATION",
      fixtureFor("state-mutation-authority-value/v1"),
      { pathBindings: {}, transactionId: null, sourceToken: "none" },
    );
    const selectedEpoch = {
      tipDigest: authorityEpoch.tipDigest,
      valueDigest: authorityEpoch.valueDigest,
      proposalReceiptDigest: authorityEpoch.proposalReceiptDigest,
    };
    const reservationSelection = pointerSelection("RECOVERY_ATTEMPT_RESERVATION", reservation, {
      pathBindings: {
        transactionId: uuid,
        sourceToken: "recovery-fence-v2",
        predecessorKey: computeReservationPredecessorKey({
          transactionId: uuid,
          sourceToken: "recovery-fence-v2",
          priorDt: null,
          priorDv: null,
          priorDr: null,
        }),
      },
      transactionId: uuid,
      sourceToken: "recovery-fence-v2",
      authorityEpoch: selectedEpoch,
    });
    const gateHistory = [fixtureFor("activation-cleanup-gate-head/v2")];
    const fenceHistory = [fixtureFor("activation-recovery-fence-head/v2")];
    const ready = {
      ...fixtureFor("activation-recovery-launch/v2"),
      gateHeadDigest: canonicalDigest(gateHistory[0]!),
      fenceHeadDigest: canonicalDigest(fenceHistory[0]!),
    };
    const live = {
      ...ready,
      lifecycle: "LIVE",
      ordinal: 1,
      previousRecordDigest: canonicalDigest(ready),
      processIdentityDigest: digest2,
    };
    const liveDescriptor: ContractRecord = {
      ...descriptor,
      lifecycle: "LIVE",
      readyRecordDigest: canonicalDigest(ready),
      initialLiveRecordDigest: canonicalDigest(live),
      processIdentityDigest: digest2,
      startedAt: instant,
      gateHeadDigest: ready.gateHeadDigest,
      fenceHeadDigest: ready.fenceHeadDigest,
      reservationTipDigest: reservationSelection.tipDigest,
      reservationValueDigest: reservationSelection.valueDigest,
      reservationReceiptDigest: reservationSelection.proposalReceiptDigest,
    };
    const accumulator = {
      ...fixtureFor("recovery-attempt-accumulator/v1"),
      descriptorDigest: canonicalDigest(liveDescriptor),
      reservationTipDigest: reservationSelection.tipDigest,
      reservationValueDigest: reservationSelection.valueDigest,
      reservationReceiptDigest: reservationSelection.proposalReceiptDigest,
    };
    const accumulatorSelection = pointerSelection("RECOVERY_ATTEMPT_ACCUMULATOR", accumulator, {
      pathBindings: { transactionId: uuid, sourceToken: "recovery-fence-v2" },
      transactionId: uuid,
      sourceToken: "recovery-fence-v2",
      authorityEpoch: selectedEpoch,
    });
    expect(
      validateRecoveryAccumulatorFormula({
        accumulator,
        accumulatorSelection: accumulatorSelection.envelope,
        currentAccumulatorPredecessorSelection: null,
        descriptor: liveDescriptor,
        priorTerminalAccumulatorSelection: null,
        priorTerminalSummary: null,
        reservation,
        reservationSelection: reservationSelection.envelope,
        terminalSummary: null,
      }),
    ).toEqual([]);
    const terminalSummary = {
      ...fixtureFor("recovery-attempt-terminal-summary/v1"),
      descriptorDigest: canonicalDigest(liveDescriptor),
      reservationTipDigest: reservationSelection.tipDigest,
      reservationValueDigest: reservationSelection.valueDigest,
      reservationReceiptDigest: reservationSelection.proposalReceiptDigest,
      argvDigest: liveDescriptor.argvDigest,
      processIdentityDigest: liveDescriptor.processIdentityDigest,
    } as ContractRecord;
    const terminalSummaryDigest = canonicalDigest(terminalSummary);
    const terminalAccumulator = {
      ...accumulator,
      lifecycle: "TERMINAL",
      terminalSummaryDigest,
      rollingDigest: recoveryAccumulatorDigest(null, terminalSummaryDigest),
    };
    const terminalAccumulatorSelection = pointerSelection(
      "RECOVERY_ATTEMPT_ACCUMULATOR",
      terminalAccumulator,
      {
        pathBindings: { transactionId: uuid, sourceToken: "recovery-fence-v2" },
        transactionId: uuid,
        sourceToken: "recovery-fence-v2",
        authorityEpoch: selectedEpoch,
        prior: accumulatorSelection,
      },
    );
    expect(
      validateRecoveryAccumulatorFormula({
        accumulator: terminalAccumulator,
        accumulatorSelection: terminalAccumulatorSelection.envelope,
        currentAccumulatorPredecessorSelection: accumulatorSelection.envelope,
        descriptor: liveDescriptor,
        priorTerminalAccumulatorSelection: null,
        priorTerminalSummary: null,
        reservation,
        reservationSelection: reservationSelection.envelope,
        terminalSummary,
      }),
    ).toEqual([]);
    expect(
      validateRecoveryAccumulatorFormula({
        accumulator: { ...terminalAccumulator, rollingDigest: digest },
        accumulatorSelection: terminalAccumulatorSelection.envelope,
        currentAccumulatorPredecessorSelection: accumulatorSelection.envelope,
        descriptor: liveDescriptor,
        priorTerminalAccumulatorSelection: null,
        priorTerminalSummary: null,
        reservation,
        reservationSelection: reservationSelection.envelope,
        terminalSummary,
      }),
    ).not.toEqual([]);
    const invalidR0Selection = pointerSelection(
      "RECOVERY_ATTEMPT_ACCUMULATOR",
      terminalAccumulator,
      {
        pathBindings: { transactionId: uuid, sourceToken: "recovery-fence-v2" },
        transactionId: uuid,
        sourceToken: "recovery-fence-v2",
        authorityEpoch: selectedEpoch,
      },
    );
    expect(
      validateRecoveryAccumulatorFormula({
        accumulator: terminalAccumulator,
        accumulatorSelection: invalidR0Selection.envelope,
        currentAccumulatorPredecessorSelection: null,
        descriptor: liveDescriptor,
        priorTerminalAccumulatorSelection: null,
        priorTerminalSummary: null,
        reservation,
        reservationSelection: reservationSelection.envelope,
        terminalSummary,
      }),
    ).not.toEqual([]);
    const laterReservation = {
      ...reservation,
      attemptId: uuid2,
      predecessorAccumulatorTipDigest: terminalAccumulatorSelection.tipDigest,
      predecessorAccumulatorValueDigest: terminalAccumulatorSelection.valueDigest,
      predecessorAccumulatorReceiptDigest: terminalAccumulatorSelection.proposalReceiptDigest,
    };
    const laterReservationSelection = pointerSelection(
      "RECOVERY_ATTEMPT_RESERVATION",
      laterReservation,
      {
        pathBindings: {
          transactionId: uuid,
          sourceToken: "recovery-fence-v2",
          predecessorKey: computeReservationPredecessorKey({
            transactionId: uuid,
            sourceToken: "recovery-fence-v2",
            priorDt: terminalAccumulatorSelection.tipDigest,
            priorDv: terminalAccumulatorSelection.valueDigest,
            priorDr: terminalAccumulatorSelection.proposalReceiptDigest,
          }),
        },
        transactionId: uuid,
        sourceToken: "recovery-fence-v2",
        authorityEpoch: selectedEpoch,
      },
    );
    const laterDescriptor = {
      ...liveDescriptor,
      attemptId: uuid2,
      reservationTipDigest: laterReservationSelection.tipDigest,
      reservationValueDigest: laterReservationSelection.valueDigest,
      reservationReceiptDigest: laterReservationSelection.proposalReceiptDigest,
    };
    const laterAccumulator = {
      ...accumulator,
      attemptId: uuid2,
      descriptorDigest: canonicalDigest(laterDescriptor),
      reservationTipDigest: laterReservationSelection.tipDigest,
      reservationValueDigest: laterReservationSelection.valueDigest,
      reservationReceiptDigest: laterReservationSelection.proposalReceiptDigest,
      priorTerminalAccumulatorTipDigest: terminalAccumulatorSelection.tipDigest,
      priorTerminalAccumulatorValueDigest: terminalAccumulatorSelection.valueDigest,
      priorTerminalAccumulatorReceiptDigest: terminalAccumulatorSelection.proposalReceiptDigest,
      priorTerminalSummaryDigest: terminalSummaryDigest,
    };
    const laterAccumulatorSelection = pointerSelection(
      "RECOVERY_ATTEMPT_ACCUMULATOR",
      laterAccumulator,
      {
        pathBindings: { transactionId: uuid, sourceToken: "recovery-fence-v2" },
        transactionId: uuid,
        sourceToken: "recovery-fence-v2",
        authorityEpoch: selectedEpoch,
        prior: terminalAccumulatorSelection,
      },
    );
    expect(
      validateRecoveryAccumulatorFormula({
        accumulator: laterAccumulator,
        accumulatorSelection: laterAccumulatorSelection.envelope,
        currentAccumulatorPredecessorSelection: terminalAccumulatorSelection.envelope,
        descriptor: laterDescriptor,
        priorTerminalAccumulatorSelection: terminalAccumulatorSelection.envelope,
        priorTerminalSummary: terminalSummary,
        reservation: laterReservation,
        reservationSelection: laterReservationSelection.envelope,
        terminalSummary: null,
      }),
    ).toEqual([]);
    const laterTerminalSummary = {
      ...terminalSummary,
      attemptId: uuid2,
      descriptorDigest: canonicalDigest(laterDescriptor),
      reservationTipDigest: laterReservationSelection.tipDigest,
      reservationValueDigest: laterReservationSelection.valueDigest,
      reservationReceiptDigest: laterReservationSelection.proposalReceiptDigest,
      priorAccumulatorTipDigest: terminalAccumulatorSelection.tipDigest,
      priorAccumulatorValueDigest: terminalAccumulatorSelection.valueDigest,
      priorAccumulatorReceiptDigest: terminalAccumulatorSelection.proposalReceiptDigest,
    };
    const laterTerminalSummaryDigest = canonicalDigest(laterTerminalSummary);
    const laterTerminalAccumulator = {
      ...laterAccumulator,
      lifecycle: "TERMINAL",
      terminalSummaryDigest: laterTerminalSummaryDigest,
      rollingDigest: recoveryAccumulatorDigest(
        terminalAccumulatorSelection.valueDigest,
        laterTerminalSummaryDigest,
      ),
    };
    const laterTerminalAccumulatorSelection = pointerSelection(
      "RECOVERY_ATTEMPT_ACCUMULATOR",
      laterTerminalAccumulator,
      {
        pathBindings: { transactionId: uuid, sourceToken: "recovery-fence-v2" },
        transactionId: uuid,
        sourceToken: "recovery-fence-v2",
        authorityEpoch: selectedEpoch,
        prior: laterAccumulatorSelection,
      },
    );
    expect(
      validateRecoveryAccumulatorFormula({
        accumulator: laterTerminalAccumulator,
        accumulatorSelection: laterTerminalAccumulatorSelection.envelope,
        currentAccumulatorPredecessorSelection: laterAccumulatorSelection.envelope,
        descriptor: laterDescriptor,
        priorTerminalAccumulatorSelection: terminalAccumulatorSelection.envelope,
        priorTerminalSummary: terminalSummary,
        reservation: laterReservation,
        reservationSelection: laterReservationSelection.envelope,
        terminalSummary: laterTerminalSummary,
      }),
    ).toEqual([]);
    const laterFormula = {
      accumulator: laterTerminalAccumulator,
      accumulatorSelection: laterTerminalAccumulatorSelection.envelope,
      currentAccumulatorPredecessorSelection: laterAccumulatorSelection.envelope,
      descriptor: laterDescriptor,
      priorTerminalAccumulatorSelection: terminalAccumulatorSelection.envelope,
      priorTerminalSummary: terminalSummary,
      reservation: laterReservation,
      reservationSelection: laterReservationSelection.envelope,
      terminalSummary: laterTerminalSummary,
    };
    expect(
      validateRecoveryAccumulatorFormula({
        ...laterFormula,
        currentAccumulatorPredecessorSelection: terminalAccumulatorSelection.envelope,
        priorTerminalAccumulatorSelection: laterAccumulatorSelection.envelope,
      }),
    ).not.toEqual([]);
    const staleLaterAccumulatorSelection = pointerSelection(
      "RECOVERY_ATTEMPT_ACCUMULATOR",
      { ...laterAccumulator, updatedAt: "2026-08-16T12:35:56.789Z" },
      {
        pathBindings: { transactionId: uuid, sourceToken: "recovery-fence-v2" },
        transactionId: uuid,
        sourceToken: "recovery-fence-v2",
        authorityEpoch: selectedEpoch,
        prior: terminalAccumulatorSelection,
      },
    );
    expect(
      validateRecoveryAccumulatorFormula({
        ...laterFormula,
        currentAccumulatorPredecessorSelection: staleLaterAccumulatorSelection.envelope,
      }),
    ).not.toEqual([]);
    for (const [field, replacement] of [
      ["installationId", uuid2],
      ["projectId", uuid2],
      ["stateRootDigest", digest2],
      ["transactionId", uuid2],
      ["sourceToken", "cleanup-gate-pre-fence-v2"],
      ["canonicalPointerPath", "installation/activation-recovery-launches/alias/accumulator.json"],
    ] as const)
      expect(
        validateRecoveryAccumulatorFormula({
          ...laterFormula,
          priorTerminalAccumulatorSelection: {
            ...terminalAccumulatorSelection.envelope,
            [field]: replacement,
          },
        }),
        `predecessor:${field}`,
      ).not.toEqual([]);
    for (const role of [
      "currentAccumulatorPredecessorSelection",
      "priorTerminalAccumulatorSelection",
    ] as const)
      for (const [field, replacement] of [
        ["installationId", uuid2],
        ["projectId", uuid2],
        ["stateRootDigest", digest2],
        ["transactionId", uuid2],
        ["sourceToken", "cleanup-gate-pre-fence-v2"],
        ["canonicalPointerPath", "installation/alias/accumulator.json"],
      ] as const)
        expect(
          validateRecoveryAccumulatorFormula({
            ...laterFormula,
            [role]: { ...(laterFormula[role] as ContractRecord), [field]: replacement },
          }),
          `${role}:${field}`,
        ).not.toEqual([]);
    for (const field of [
      "priorTerminalAccumulatorTipDigest",
      "priorTerminalAccumulatorValueDigest",
      "priorTerminalAccumulatorReceiptDigest",
    ])
      expect(
        validateRecoveryAccumulatorFormula({
          ...laterFormula,
          accumulator: { ...laterTerminalAccumulator, [field]: digest },
        }),
        `accumulator:${field}`,
      ).not.toEqual([]);
    for (const field of [
      "predecessorAccumulatorTipDigest",
      "predecessorAccumulatorValueDigest",
      "predecessorAccumulatorReceiptDigest",
    ])
      expect(
        validateRecoveryAccumulatorFormula({
          ...laterFormula,
          reservation: { ...laterReservation, [field]: digest },
        }),
        `reservation:${field}`,
      ).not.toEqual([]);
    expect(
      validateRecoveryAccumulatorFormula({
        ...laterFormula,
        predecessorAccumulatorSelection: laterAccumulatorSelection.envelope,
      }),
    ).not.toEqual([]);
    const splitCurrent = pointerSelection(
      "RECOVERY_ATTEMPT_ACCUMULATOR",
      laterTerminalAccumulator,
      {
        pathBindings: { transactionId: uuid, sourceToken: "recovery-fence-v2" },
        transactionId: uuid,
        sourceToken: "recovery-fence-v2",
        authorityEpoch: selectedEpoch,
        prior: terminalAccumulatorSelection,
      },
    );
    expect(
      validateRecoveryAccumulatorFormula({
        ...laterFormula,
        accumulatorSelection: splitCurrent.envelope,
      }),
    ).not.toEqual([]);
    expect(
      validateRecoveryAccumulatorFormula({
        ...laterFormula,
        priorTerminalSummary: { ...terminalSummary, attemptId: uuid2 },
      }),
    ).not.toEqual([]);
    const postConsume = fixtureFor("recovery-authorization-consume-receipt/v1");
    const attached = {
      ...fixtureFor("recovery-authorization-attachment/v1"),
      lifecycle: "ATTACHED",
      activeReleaseDigest: digest,
      argvDigest: liveDescriptor.argvDigest,
      brokerClientDigest: digest,
      descriptorDigest: canonicalDigest(liveDescriptor),
      fenceHeadDigest: liveDescriptor.fenceHeadDigest,
      gateHeadDigest: liveDescriptor.gateHeadDigest,
      initialLiveRecordDigest: liveDescriptor.initialLiveRecordDigest,
      processIdentityDigest: liveDescriptor.processIdentityDigest,
      readyRecordDigest: liveDescriptor.readyRecordDigest,
      reservationReceiptDigest: liveDescriptor.reservationReceiptDigest,
      reservationTipDigest: liveDescriptor.reservationTipDigest,
      reservationValueDigest: liveDescriptor.reservationValueDigest,
      consumeReceiptDigest: canonicalDigest(postConsume),
    } as ContractRecord;
    const gateSelection = pointerSelection("ACTIVATION_CLEANUP_GATE", gateHistory[0]!, {
      pathBindings: {},
      transactionId: uuid,
      sourceToken: "none",
      authorityEpoch: selectedEpoch,
    });
    const fenceSelection = pointerSelection("ACTIVATION_RECOVERY_FENCE", fenceHistory[0]!, {
      pathBindings: {},
      transactionId: uuid,
      sourceToken: "none",
      authorityEpoch: selectedEpoch,
    });
    const launchSelection = pointerSelection("ACTIVATION_RECOVERY_LAUNCH", live, {
      pathBindings: { transactionId: uuid, sourceToken: "recovery-fence-v2" },
      transactionId: uuid,
      sourceToken: "recovery-fence-v2",
      authorityEpoch: selectedEpoch,
    });
    const attachmentSelection = pointerSelection("RECOVERY_AUTHORIZATION_ATTACHMENT", attached, {
      pathBindings: { transactionId: uuid },
      transactionId: uuid,
      sourceToken: "none",
      authorityEpoch: selectedEpoch,
    });
    const epochSequence = ordinaryEpochSequence.map((step) => ({
      step,
      authorityEpochDigest: authorityEpoch.valueDigest,
      authorityEpochTipDigest: authorityEpoch.tipDigest,
      authorityEpochValueDigest: authorityEpoch.valueDigest,
      authorityEpochReceiptDigest: authorityEpoch.proposalReceiptDigest,
    }));
    const packet = {
      accumulator,
      accumulatorSelection: accumulatorSelection.envelope,
      attachment: attached,
      attachmentSelection: attachmentSelection.envelope,
      authorityEpochSelection: authorityEpoch.envelope,
      descriptor: liveDescriptor,
      epochSequence,
      gateHistory,
      gateSelection: gateSelection.envelope,
      fenceHistory,
      fenceSelection: fenceSelection.envelope,
      launchHistory: [ready, live],
      launchSelection: launchSelection.envelope,
      postConsume,
      currentAccumulatorPredecessorSelection: null,
      priorTerminalAccumulatorSelection: null,
      priorTerminalSummaries: [],
      reservation,
      reservationSelection: reservationSelection.envelope,
    };
    expect(validateEvidencePacket(packet)).toEqual([]);
    expect(
      validateEvidencePacket({
        ...packet,
        currentAccumulatorPredecessorSelection: accumulatorSelection.envelope,
      }),
    ).not.toEqual([]);
    expect(
      validateEvidencePacket({
        ...packet,
        epochSequence: epochSequence.map((entry) => ({
          ...entry,
          authorityEpochDigest: digest,
          authorityEpochTipDigest: digest2,
          authorityEpochValueDigest: digest,
          authorityEpochReceiptDigest: digest2,
        })),
      }),
    ).toContain("epochSequence:authority-selection-mismatch");
    expect(
      canonicalDigest(
        [
          authorityEpoch,
          gateSelection,
          fenceSelection,
          launchSelection,
          reservationSelection,
          attachmentSelection,
          accumulatorSelection,
        ].map((selection) => ({
          pathInstanceDigest: selection.pathInstanceDigest,
          proposalReceiptDigest: selection.proposalReceiptDigest,
          tipDigest: selection.tipDigest,
          valueDigest: selection.valueDigest,
        })),
      ),
    ).toBe("7627a4f27cf34b862b72220bbb6edbde70042f8ad7d207cfc0371b8a0deb7cb9");
    expect(validateSelectedPointerEvidence(reservationSelection.envelope)).toEqual([]);
    expect(
      validateEvidencePacket({
        ...packet,
        reservationSelection: {
          ...reservationSelection.envelope,
          tip: { ...reservationSelection.tip, proposalReceiptDigest: digest },
        },
      }),
    ).not.toEqual([]);
    for (const [field, selection] of [
      ["gateSelection", gateSelection],
      ["fenceSelection", fenceSelection],
      ["launchSelection", launchSelection],
      ["reservationSelection", reservationSelection],
      ["attachmentSelection", attachmentSelection],
      ["accumulatorSelection", accumulatorSelection],
    ] as const)
      expect(
        validateEvidencePacket({
          ...packet,
          [field]: {
            ...selection.envelope,
            tip: { ...selection.tip, proposalReceiptDigest: digest },
          },
        }),
        field,
      ).not.toEqual([]);
    expect(
      validateEvidencePacket({
        ...packet,
        launchSelection: {
          ...launchSelection.envelope,
          proposal: {
            ...launchSelection.proposal,
            authorityEpochTipDigest: digest,
          },
        },
      }),
    ).not.toEqual([]);
    expect(validateEvidencePacket({ ...packet, gateHistory: [1] })).not.toEqual([]);
    expect(validateEvidencePacket({ ...packet, descriptor: 1 })).not.toEqual([]);
    expect(validateEvidencePacket({ ...packet, launchHistory: [1] })).not.toEqual([]);
    expect(
      validateEvidencePacket({
        ...packet,
        priorTerminalSummaries: Array(
          fixedEvidencePacketLimits.maximumPriorTerminalSummaries + 1,
        ).fill(digest),
      }),
    ).toContain("priorTerminalSummaries:limit-exceeded");
  });

  test("pins every authorization, reservation, launch, attachment, accumulator, retention, and tombstone phase", () => {
    const state0 = fixtureFor("recovery-authorization-state/v2");
    const state1 = {
      ...state0,
      lifecycle: "CONSUMED",
      gateRootDigest: digest,
      nativeConsumeReceiptDigest: digest,
    };
    const state2 = { ...state1, lifecycle: "REVOKED", nativeRemovalReceiptDigest: digest2 };
    const reservation0 = fixtureFor("recovery-attempt-reservation/v1");
    const reservation1 = {
      ...reservation0,
      lifecycle: "CONSUMED",
      consumedDescriptorDigest: digest,
    };
    const reservation2 = { ...reservation1, lifecycle: "TERMINAL", terminalSummaryDigest: digest2 };
    const reservation3 = {
      ...reservation2,
      lifecycle: "TOMBSTONE",
      tombstoneArchiveDigest: digest,
    };
    const launch0 = fixtureFor("activation-recovery-launch/v2");
    const launch1 = { ...launch0, lifecycle: "LIVE", processIdentityDigest: digest };
    const launch2 = { ...launch1, lifecycle: "TERMINAL_RETRYABLE", terminalProofDigest: digest2 };
    const descriptor0 = fixtureFor("recovery-attempt-descriptor/v1");
    const descriptor1 = {
      ...descriptor0,
      lifecycle: "LIVE",
      initialLiveRecordDigest: digest,
      processIdentityDigest: digest2,
      startedAt: instant,
    };
    const attachment0 = fixtureFor("recovery-authorization-attachment/v1");
    const attachedFields = {
      activeReleaseDigest: digest,
      argvDigest: digest,
      brokerClientDigest: digest,
      descriptorDigest: digest,
      fenceHeadDigest: digest,
      gateHeadDigest: digest,
      initialLiveRecordDigest: digest,
      processIdentityDigest: digest,
      readyRecordDigest: digest,
      reservationReceiptDigest: digest,
      reservationTipDigest: digest,
      reservationValueDigest: digest,
    };
    const attachment1 = { ...attachment0, ...attachedFields, lifecycle: "ATTACHED" };
    const attachmentLater = {
      ...attachment1,
      priorAttachmentTipDigest: digest,
      priorAttachmentValueDigest: digest,
      priorAttachmentReceiptDigest: digest,
      priorTerminalAccumulatorTipDigest: digest2,
      priorTerminalAccumulatorValueDigest: digest2,
      priorTerminalAccumulatorReceiptDigest: digest2,
      priorTerminalSummaryDigest: digest2,
    };
    const attachment2 = { ...attachment1, lifecycle: "TERMINAL", terminalSummaryDigest: digest2 };
    const accumulator0 = fixtureFor("recovery-attempt-accumulator/v1");
    const accumulator1 = {
      ...accumulator0,
      lifecycle: "TERMINAL",
      terminalSummaryDigest: digest,
      rollingDigest: digest2,
    };
    const retention0 = fixtureFor("authority-retention/v1");
    const retention1 = {
      ...retention0,
      recordClass: "TERMINAL_ATTEMPT_HISTORY",
      phase: "CHECKPOINTED",
      checkpointDigest: digest,
    };
    const tombstone = fixtureFor("pointer-tombstone-value/v1");
    const sequences = [
      ["recovery-authorization-state/v2", [state0, state1, state2]],
      ["recovery-attempt-reservation/v1", [reservation0, reservation1, reservation2, reservation3]],
      ["activation-recovery-launch/v2", [launch0, launch1, launch2]],
      ["recovery-attempt-descriptor/v1", [descriptor0, descriptor1]],
      [
        "recovery-authorization-attachment/v1",
        [attachment0, attachment1, attachmentLater, attachment2],
      ],
      ["recovery-attempt-accumulator/v1", [accumulator0, accumulator1]],
      ["authority-retention/v1", [retention0, retention1]],
      ["pointer-tombstone-value/v1", [tombstone]],
    ] as const;
    const sequenceDigests: { digest: string; schemaVersion: string }[] = [];
    for (const [schemaVersion, values] of sequences)
      for (const record of values) {
        const labelRecord: ContractRecord = record;
        expect(
          parseContract(schemaVersion, record).ok,
          `${schemaVersion}:${String(labelRecord.lifecycle ?? labelRecord.phase ?? "value")}`,
        ).toBe(true);
        sequenceDigests.push({ digest: canonicalDigest(record), schemaVersion });
      }
    expect(
      parseContract("recovery-authorization-attachment/v1", {
        ...attachmentLater,
        priorAttachmentReceiptDigest: null,
      }).ok,
    ).toBe(false);
    expect(canonicalDigest(sequenceDigests)).toBe(
      "7e2f067ef6f97b5209682d510b8ac251cf9312c7ac92220110c7352cbc058784",
    );
    expect(recoveryAccumulatorDigest(null, digest)).toBe(
      "53e8330f18608045b35f390a91f9a2dfd97fc43064ba10d79071aa18f25de511",
    );
    expect(recoveryAccumulatorDigest(digest2, digest)).toBe(
      "934a3d1b05d1bd3fcf84783bd046b88662d321930e2d5965012c2fd87a290ea7",
    );
    expect(recoveryAccumulatorDigest(null, digest)).not.toBe(
      computePointerValueDigest("RECOVERY_ATTEMPT_ACCUMULATOR", digest2, accumulator0),
    );
  });
});

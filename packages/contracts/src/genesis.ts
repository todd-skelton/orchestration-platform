import {
  computeDestinationOwnerSuccessorReviewCoreDigest,
  parseDestinationOwnerSuccessorPostSelection,
  parseDestinationOwnerSuccessorReviewCore,
  validateDestinationOwnerSuccessorPostSelectionBinding,
  validateDestinationOwnerSuccessorReviewCoreBinding,
} from "./successor.js";
import {
  computeBootstrapAnchorDigest,
  computeBootstrapAnchorProposalDigest,
  computeBootstrapAnchorTipDigest,
  computeBootstrapAnchorValueDigest,
  parseBootstrapAnchor,
  parseBootstrapAnchorLifecycleValue,
  parseBootstrapAnchorProposal,
  parseBootstrapAnchorTip,
  validateBootstrapAnchorMutationBinding,
} from "./anchor.js";
import {
  computeAuthorityHistoryRecordDigest,
  computeGenesisBootstrapInputDigest,
  computeSuccessorAuthorityCoreDigest,
  parseAuthorityHistoryRecord,
  parseGenesisBootstrapInput,
  parseReviewedAuthorityOperation,
  parseStateMutationAuthorityValue,
  parseSuccessorAuthorityCore,
} from "./authority.js";
import {
  computeStateMutationGlobalIdentityDigest,
  parseStateMutationGlobalIdentity,
} from "./evidence.js";
import {
  computeExternalDestinationAbsenceObservationDigest,
  computePhysicalLocatorObservationDigest,
  parseExternalDestinationAbsenceObservation,
  parsePhysicalDestinationIdentity,
  parsePhysicalLocatorObservation,
  validateExternalAbsenceBinding,
  validatePhysicalObservationBinding,
} from "./external.js";
import {
  bootstrapUseIntentExpectationFields,
  computeBootstrapAnchorUseIntentDigest,
  parseBootstrapAnchorUseIntent,
  validateBootstrapAnchorUseIntentBinding,
} from "./intent.js";
import {
  computeDestinationOwnerProposalDigest,
  computeDestinationOwnerTipDigest,
  computeDestinationOwnerValueDigest,
  parseDestinationOwnerProposal,
  parseDestinationOwnerTip,
  parseDestinationOwnerValue,
  validateDestinationOwnerMutationBinding,
} from "./owner.js";
import {
  computeCurrentTipDigest,
  computeMutationId,
  computePointerInstanceDigest,
  computePointerPositionDigest,
  computePointerValueDigest,
  computeProposalReceiptDigest,
  parsePointerCurrentTip,
  parsePointerProposal,
  stateMutationAuthorityPath,
} from "./pointer.js";
import {
  canonicalDigest,
  frame,
  framedDigest,
  isCanonicalTimestamp,
  isSha256,
  isUuidV7,
  snapshotClosedRecord,
  type ContractRecord,
  type ParseResult,
} from "./runtime.js";

const coreFields = Object.freeze([
  "anchorDigest",
  "authorityPathInstanceDigest",
  "authorityValueDigest",
  "bootstrapTransactionId",
  "destinationAbsenceDigest",
  "destinationDigest",
  "destinationOwnerActiveReceiptDigest",
  "destinationOwnerActiveTipDigest",
  "destinationOwnerActiveValueDigest",
  "genesisBootstrapInputDigest",
  "genesisHistoryRecordDigest",
  "genesisPositionDigest",
  "globalIdentityDigest",
  "schemaVersion",
  "successorCoreDigest",
] as const);
const postFields = Object.freeze([
  "anchorDigest",
  "authorityPathInstanceDigest",
  "bootstrapGenesisCoreDigest",
  "observedAt",
  "proposalReadbackDigest",
  "receiptDigest",
  "schemaVersion",
  "tipDigest",
  "tipReadbackDigest",
  "valueDigest",
  "valueReadbackDigest",
] as const);
const coreExpectationFields = Object.freeze([
  "activeReleasePathInstanceDigest",
  "activeReleaseReceiptDigest",
  "activeReleaseTipDigest",
  "activeReleaseValueDigest",
] as const);
const postExpectationFields = Object.freeze([
  "anchorDigest",
  "authorityPathInstanceDigest",
  "bootstrapGenesisCoreDigest",
] as const);

export const bootstrapGenesisSchemaFields = Object.freeze({ core: coreFields, post: postFields });
export const bootstrapGenesisSchemaVersions = Object.freeze([
  "state-mutation-bootstrap-genesis-core/v1",
  "state-mutation-bootstrap-genesis-post-selection-receipt/v1",
] as const);

function invalid(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function digestIssues(record: ContractRecord, fields: readonly string[]): string[] {
  return fields.filter((field) => !isSha256(record[field])).map((field) => `${field}:invalid`);
}

function prefixed(prefix: string, parsed: ParseResult): string[] {
  return parsed.ok ? [] : parsed.issues.map((issue) => `${prefix}:${issue}`);
}

function parsedOrThrow(parser: (input: unknown) => ParseResult, input: unknown): ContractRecord {
  const parsed = parser(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return parsed.value;
}

export function parseBootstrapGenesisCore(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, coreFields);
  if (!parsed.ok) return parsed;
  const issues = digestIssues(
    parsed.value,
    coreFields.filter((field) => field.endsWith("Digest")),
  );
  if (!isUuidV7(parsed.value.bootstrapTransactionId)) issues.push("bootstrapTransactionId:invalid");
  if (parsed.value.schemaVersion !== "state-mutation-bootstrap-genesis-core/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseBootstrapGenesisPostSelection(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, postFields);
  if (!parsed.ok) return parsed;
  const issues = digestIssues(
    parsed.value,
    postFields.filter((field) => field.endsWith("Digest")),
  );
  if (!isCanonicalTimestamp(parsed.value.observedAt)) issues.push("observedAt:invalid");
  if (parsed.value.schemaVersion !== "state-mutation-bootstrap-genesis-post-selection-receipt/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computeBootstrapGenesisCoreDigest(input: unknown): string {
  const core = parsedOrThrow(parseBootstrapGenesisCore, input);
  return framedDigest("state-mutation-bootstrap-genesis-core/v1", [
    frame.raw32(String(core.anchorDigest)),
    frame.raw32(String(core.globalIdentityDigest)),
    frame.text(String(core.bootstrapTransactionId)),
    frame.raw32(String(core.authorityPathInstanceDigest)),
    frame.raw32(String(core.authorityValueDigest)),
    frame.raw32(String(core.genesisPositionDigest)),
    frame.canonical(core),
  ]);
}

export function computeBootstrapGenesisPostSelectionDigest(input: unknown): string {
  const post = parsedOrThrow(parseBootstrapGenesisPostSelection, input);
  return framedDigest("state-mutation-bootstrap-genesis-post-selection-receipt/v1", [
    frame.raw32(String(post.anchorDigest)),
    frame.raw32(String(post.bootstrapGenesisCoreDigest)),
    frame.raw32(String(post.authorityPathInstanceDigest)),
    frame.raw32(String(post.valueDigest)),
    frame.raw32(String(post.receiptDigest)),
    frame.raw32(String(post.tipDigest)),
    frame.raw32(String(post.valueReadbackDigest)),
    frame.raw32(String(post.proposalReadbackDigest)),
    frame.raw32(String(post.tipReadbackDigest)),
    frame.canonical(post),
  ]);
}

function authorityIdentity(anchor: ContractRecord) {
  return {
    pointerKind: "STATE_MUTATION_AUTHORITY_ROTATION" as const,
    canonicalPointerPath: stateMutationAuthorityPath,
    installationId: String(anchor.installationId),
    projectId: String(anchor.projectId),
    stateRootDigest: String(anchor.stateRootDigest),
    transactionId: null,
    sourceToken: "none",
    positionEvidence: { mode: "VALUE", parts: {} },
  };
}

export function validateBootstrapGenesisCoreBinding(
  coreInput: unknown,
  anchorInput: unknown,
  anchorTipInput: unknown,
  anchorValueInput: unknown,
  anchorProposalInput: unknown,
  ownerTipInput: unknown,
  ownerValueInput: unknown,
  ownerProposalInput: unknown,
  intentInput: unknown,
  genesisInput: unknown,
  historyRecordInput: unknown,
  reviewedOperationInput: unknown,
  successorCoreInput: unknown,
  authorityValueInput: unknown,
  globalIdentityInput: unknown,
  priorOwnerTipInput: unknown,
  priorOwnerValueInput: unknown,
  priorOwnerProposalInput: unknown,
  ownerTeardownArchiveInput: unknown,
  successorReviewCoreInput: unknown,
  successorReviewExpectedInput: unknown,
  successorPostSelectionInput: unknown,
  successorPostExpectedInput: unknown,
  physicalIdentityInput: unknown,
  locatorObservationInput: unknown,
  absenceInput: unknown,
  intentExpectedInput: unknown,
  absenceExpectedInput: unknown,
  expectedInput: unknown,
): readonly string[] {
  const core = parseBootstrapGenesisCore(coreInput);
  const anchor = parseBootstrapAnchor(anchorInput);
  const anchorTip = parseBootstrapAnchorTip(anchorTipInput);
  const anchorValue = parseBootstrapAnchorLifecycleValue(anchorValueInput);
  const anchorProposal = parseBootstrapAnchorProposal(anchorProposalInput);
  const ownerTip = parseDestinationOwnerTip(ownerTipInput);
  const ownerValue = parseDestinationOwnerValue(ownerValueInput);
  const ownerProposal = parseDestinationOwnerProposal(ownerProposalInput);
  const intent = parseBootstrapAnchorUseIntent(intentInput);
  const genesisInputRecord = parseGenesisBootstrapInput(genesisInput);
  const history = parseAuthorityHistoryRecord(historyRecordInput);
  const operation = parseReviewedAuthorityOperation(reviewedOperationInput);
  const successor = parseSuccessorAuthorityCore(successorCoreInput);
  const authorityValue = parseStateMutationAuthorityValue(authorityValueInput);
  const globalIdentity = parseStateMutationGlobalIdentity(globalIdentityInput);
  const identity = parsePhysicalDestinationIdentity(physicalIdentityInput);
  const observation = parsePhysicalLocatorObservation(locatorObservationInput);
  const absence = parseExternalDestinationAbsenceObservation(absenceInput);
  const expected = snapshotClosedRecord(expectedInput, coreExpectationFields);
  const intentExpected = snapshotClosedRecord(
    intentExpectedInput,
    bootstrapUseIntentExpectationFields,
  );
  const issues = [
    ...prefixed("core", core),
    ...prefixed("anchor", anchor),
    ...prefixed("anchorTip", anchorTip),
    ...prefixed("anchorValue", anchorValue),
    ...prefixed("anchorProposal", anchorProposal),
    ...prefixed("ownerTip", ownerTip),
    ...prefixed("ownerValue", ownerValue),
    ...prefixed("ownerProposal", ownerProposal),
    ...prefixed("intent", intent),
    ...prefixed("genesisInput", genesisInputRecord),
    ...prefixed("historyRecord", history),
    ...prefixed("reviewedOperation", operation),
    ...prefixed("successorCore", successor),
    ...prefixed("authorityValue", authorityValue),
    ...prefixed("globalIdentity", globalIdentity),
    ...prefixed("identity", identity),
    ...prefixed("observation", observation),
    ...prefixed("absence", absence),
    ...(expected.ok ? [] : expected.issues.map((issue) => `expected:${issue}`)),
    ...(intentExpected.ok ? [] : intentExpected.issues.map((issue) => `intentExpected:${issue}`)),
  ];
  if (
    !core.ok ||
    !anchor.ok ||
    !anchorTip.ok ||
    !anchorValue.ok ||
    !anchorProposal.ok ||
    !ownerTip.ok ||
    !ownerValue.ok ||
    !ownerProposal.ok ||
    !intent.ok ||
    !genesisInputRecord.ok ||
    !history.ok ||
    !operation.ok ||
    !successor.ok ||
    !authorityValue.ok ||
    !globalIdentity.ok ||
    !identity.ok ||
    !observation.ok ||
    !absence.ok ||
    !expected.ok ||
    !intentExpected.ok
  )
    return Object.freeze([...new Set(issues)].sort());
  for (const field of coreExpectationFields)
    if (!isSha256(expected.value[field])) issues.push(`expected:${field}:invalid`);
  if (issues.length > 0) return Object.freeze([...new Set(issues)].sort());

  const c = core.value;
  const a = anchor.value;
  const at = anchorTip.value;
  const av = anchorValue.value;
  const ap = anchorProposal.value;
  const ot = ownerTip.value;
  const ov = ownerValue.value;
  const op = ownerProposal.value;
  const i = intent.value;
  const gb = genesisInputRecord.value;
  const h = history.value;
  const operationRecord = operation.value;
  const sc = successor.value;
  const authority = authorityValue.value;
  const global = globalIdentity.value;
  const missing = absence.value;
  const proposed = i.proposedGenesisInput as ContractRecord;
  let anchorDigest: string;
  let successorCoreDigest: string;
  try {
    anchorDigest = computeBootstrapAnchorDigest(a);
    successorCoreDigest = computeSuccessorAuthorityCoreDigest(sc, operationRecord);
  } catch (error) {
    issues.push(
      String((error as Error)?.message).includes("globalBootstrapIdentityDigest")
        ? "anchor:globalBootstrapIdentityDigest:mismatch"
        : "successorCore:reviewed-operation-mismatch",
    );
    return Object.freeze([...new Set(issues)].sort());
  }
  const anchorTipDigest = computeBootstrapAnchorTipDigest(at);
  const anchorValueDigest = computeBootstrapAnchorValueDigest(av);
  const anchorReceiptDigest = computeBootstrapAnchorProposalDigest(ap);
  const ownerTipDigest = computeDestinationOwnerTipDigest(ot);
  const ownerValueDigest = computeDestinationOwnerValueDigest(ov);
  const ownerReceiptDigest = computeDestinationOwnerProposalDigest(op);
  const useIntentDigest = computeBootstrapAnchorUseIntentDigest(i);
  const genesisBootstrapInputDigest = computeGenesisBootstrapInputDigest(gb);
  const historyRecordDigest = computeAuthorityHistoryRecordDigest(h);
  const dp = computePointerInstanceDigest(authorityIdentity(a));
  const genesisPositionDigest = computePointerPositionDigest("STATE_MUTATION_AUTHORITY_ROTATION", {
    mode: "VALUE",
    parts: {},
  });
  const dv = computePointerValueDigest("STATE_MUTATION_AUTHORITY_ROTATION", dp, authority);
  const absenceDigest = computeExternalDestinationAbsenceObservationDigest(missing);
  const observationDigest = computePhysicalLocatorObservationDigest(observation.value);
  const globalIdentityDigest = computeStateMutationGlobalIdentityDigest(global);

  issues.push(
    ...validateBootstrapAnchorUseIntentBinding(
      i,
      a,
      at,
      av,
      ap,
      ot,
      ov,
      op,
      intentExpectedInput,
    ).map((issue) => `intentBinding:${issue}`),
    ...validateExternalAbsenceBinding(
      identity.value,
      observation.value,
      missing,
      absenceExpectedInput,
    ).map((issue) => `absenceBinding:${issue}`),
    ...validatePhysicalObservationBinding(
      identity.value,
      observation.value,
      String(intentExpected.value.effectiveAt),
      {
        locatorObservationDigest: observationDigest,
        physicalDestinationIdentityDigest: missing.physicalDestinationIdentityDigest,
      },
    ).map((issue) => `effectiveObservation:${issue}`),
    ...validateBootstrapAnchorMutationBinding(a, ap, av, null, null, null, {
      anchorDigest,
      transitionEvidenceDigest: a.bootstrapGrantDigest,
    }).map((issue) => `anchorMutation:${issue}`),
  );
  if (a.successorReviewCoreDigest === null)
    issues.push(
      ...validateDestinationOwnerMutationBinding(op, ov, null, null, null, {
        anchorDigest,
        destinationDigest: a.destinationDigest,
        installationId: a.installationId,
        observationDigest,
        transitionEvidenceDigest: a.bootstrapGrantDigest,
      }).map((issue) => `ownerMutation:${issue}`),
    );
  const successorInputs = [
    priorOwnerTipInput,
    priorOwnerValueInput,
    priorOwnerProposalInput,
    ownerTeardownArchiveInput,
    successorReviewCoreInput,
    successorReviewExpectedInput,
    successorPostSelectionInput,
    successorPostExpectedInput,
  ];
  if (a.successorReviewCoreDigest === null) {
    if (!successorInputs.every((input) => input === null))
      issues.push("successorProvenance:genesis-forbidden");
  } else if (successorInputs.some((input) => input === null)) {
    issues.push("successorProvenance:successor-required");
  } else {
    const reviewCore = parseDestinationOwnerSuccessorReviewCore(successorReviewCoreInput);
    const successorPost = parseDestinationOwnerSuccessorPostSelection(successorPostSelectionInput);
    issues.push(
      ...prefixed("successorReviewCore", reviewCore),
      ...prefixed("successorPostSelection", successorPost),
      ...validateDestinationOwnerSuccessorReviewCoreBinding(
        successorReviewCoreInput,
        priorOwnerTipInput,
        priorOwnerValueInput,
        priorOwnerProposalInput,
        ownerTeardownArchiveInput,
        successorReviewExpectedInput,
      ).map((issue) => `successorReview:${issue}`),
      ...validateDestinationOwnerSuccessorPostSelectionBinding(
        successorPostSelectionInput,
        successorReviewCoreInput,
        ov,
        op,
        ot,
        priorOwnerTipInput,
        priorOwnerValueInput,
        priorOwnerProposalInput,
        successorPostExpectedInput,
      ).map((issue) => `successorPost:${issue}`),
    );
    if (reviewCore.ok && successorPost.ok) {
      const reviewCoreDigest = computeDestinationOwnerSuccessorReviewCoreDigest(reviewCore.value);
      for (const [field, actual, selected] of [
        ["anchor.successorReviewCoreDigest", a.successorReviewCoreDigest, reviewCoreDigest],
        ["ownerProposal.observationDigest", op.observationDigest, observationDigest],
        [
          "intentExpected.successorPostSelectionReceiptReadbackDigest",
          intentExpected.value.successorPostSelectionReceiptReadbackDigest,
          canonicalDigest(successorPost.value),
        ],
        [
          "intentExpected.successorPostSelectionReceipt",
          canonicalDigest(intentExpected.value.successorPostSelectionReceipt),
          canonicalDigest(successorPost.value),
        ],
      ] as const)
        if (actual !== selected) issues.push(`${field}:mismatch`);
    }
  }

  for (const [field, actual, selected] of [
    ["anchor.authorityPathInstanceDigest", a.authorityPathInstanceDigest, dp],
    ["anchorDigest", c.anchorDigest, anchorDigest],
    ["authorityPathInstanceDigest", c.authorityPathInstanceDigest, dp],
    ["authorityValueDigest", c.authorityValueDigest, dv],
    ["bootstrapTransactionId", c.bootstrapTransactionId, a.bootstrapTransactionId],
    ["destinationAbsenceDigest", c.destinationAbsenceDigest, absenceDigest],
    ["destinationDigest", c.destinationDigest, a.destinationDigest],
    ["destinationOwnerActiveTipDigest", c.destinationOwnerActiveTipDigest, ownerTipDigest],
    ["destinationOwnerActiveValueDigest", c.destinationOwnerActiveValueDigest, ownerValueDigest],
    [
      "destinationOwnerActiveReceiptDigest",
      c.destinationOwnerActiveReceiptDigest,
      ownerReceiptDigest,
    ],
    ["genesisBootstrapInputDigest", c.genesisBootstrapInputDigest, genesisBootstrapInputDigest],
    ["genesisHistoryRecordDigest", c.genesisHistoryRecordDigest, historyRecordDigest],
    ["genesisPositionDigest", c.genesisPositionDigest, genesisPositionDigest],
    ["globalIdentityDigest", c.globalIdentityDigest, globalIdentityDigest],
    ["successorCoreDigest", c.successorCoreDigest, successorCoreDigest],
    [
      "intent.proposedGenesisInput.authorityPathInstanceDigest",
      proposed.authorityPathInstanceDigest,
      dp,
    ],
    [
      "intent.proposedGenesisInput.globalIdentityDigest",
      proposed.globalIdentityDigest,
      globalIdentityDigest,
    ],
    [
      "intent.proposedGenesisInput.successorCoreDigest",
      proposed.successorCoreDigest,
      successorCoreDigest,
    ],
    [
      "intent.proposedGenesisInput.genesisPositionDigest",
      proposed.genesisPositionDigest,
      genesisPositionDigest,
    ],
    ["genesisInput.destinationDigest", gb.destinationDigest, a.destinationDigest],
    [
      "genesisInput.destinationOwnerActiveTipDigest",
      gb.destinationOwnerActiveTipDigest,
      ownerTipDigest,
    ],
    [
      "genesisInput.destinationOwnerActiveValueDigest",
      gb.destinationOwnerActiveValueDigest,
      ownerValueDigest,
    ],
    [
      "genesisInput.destinationOwnerActiveReceiptDigest",
      gb.destinationOwnerActiveReceiptDigest,
      ownerReceiptDigest,
    ],
    ["genesisInput.bootstrapAnchorDigest", gb.bootstrapAnchorDigest, anchorDigest],
    [
      "genesisInput.bootstrapAnchorActiveTipDigest",
      gb.bootstrapAnchorActiveTipDigest,
      anchorTipDigest,
    ],
    [
      "genesisInput.bootstrapAnchorActiveValueDigest",
      gb.bootstrapAnchorActiveValueDigest,
      anchorValueDigest,
    ],
    [
      "genesisInput.bootstrapAnchorActiveReceiptDigest",
      gb.bootstrapAnchorActiveReceiptDigest,
      anchorReceiptDigest,
    ],
    ["genesisInput.useIntentDigest", gb.useIntentDigest, useIntentDigest],
    [
      "genesisInput.globalBootstrapIdentityDigest",
      gb.globalBootstrapIdentityDigest,
      a.globalBootstrapIdentityDigest,
    ],
    ["genesisInput.bootstrapTransactionId", gb.bootstrapTransactionId, a.bootstrapTransactionId],
    ["genesisInput.bootstrapGrantDigest", gb.bootstrapGrantDigest, a.bootstrapGrantDigest],
    ["genesisInput.successorCoreDigest", gb.successorCoreDigest, successorCoreDigest],
    ["history.globalIdentityDigest", h.globalIdentityDigest, globalIdentityDigest],
    [
      "history.genesisBootstrapInputDigest",
      h.genesisBootstrapInputDigest,
      genesisBootstrapInputDigest,
    ],
    ["history.successorCoreDigest", h.successorCoreDigest, successorCoreDigest],
    ["successorCore.authorityPathInstanceDigest", sc.authorityPathInstanceDigest, dp],
    ["successorCore.globalIdentityDigest", sc.globalIdentityDigest, globalIdentityDigest],
    ["successorCore.successorHelperDigest", sc.successorHelperDigest, a.helperDigest],
    [
      "successorCore.successorHelperProfileDigest",
      sc.successorHelperProfileDigest,
      a.helperProfileDigest,
    ],
    ["successorCore.abiDigest", sc.abiDigest, a.abiDigest],
    ["successorCore.lockProfileDigest", sc.lockProfileDigest, a.lockProfileDigest],
    [
      "successorCore.stateComponentProfileDigest",
      sc.stateComponentProfileDigest,
      a.stateComponentProfileDigest,
    ],
    ["successorCore.custodyInstanceDigest", sc.custodyInstanceDigest, a.custodyInstanceDigest],
    [
      "successorCore.admittedCustodyObservationDigest",
      sc.admittedCustodyObservationDigest,
      observationDigest,
    ],
    ["authority.globalIdentityDigest", authority.globalIdentityDigest, globalIdentityDigest],
    ["authority.headRecordDigest", authority.headRecordDigest, historyRecordDigest],
    ["authority.helperDigest", authority.helperDigest, a.helperDigest],
    ["authority.helperProfileDigest", authority.helperProfileDigest, a.helperProfileDigest],
    ["authority.helperAbiDigest", authority.helperAbiDigest, a.abiDigest],
    ["authority.lockProfileDigest", authority.lockProfileDigest, a.lockProfileDigest],
    [
      "authority.stateComponentProfileDigest",
      authority.stateComponentProfileDigest,
      a.stateComponentProfileDigest,
    ],
    ["authority.custodyInstanceDigest", authority.custodyInstanceDigest, a.custodyInstanceDigest],
    [
      "authority.admittedCustodyObservationDigest",
      authority.admittedCustodyObservationDigest,
      observationDigest,
    ],
    ["authority.installationId", authority.installationId, a.installationId],
    ["authority.projectId", authority.projectId, a.projectId],
    ["authority.stateRootDigest", authority.stateRootDigest, a.stateRootDigest],
    [
      "authority.activeReleasePathInstanceDigest",
      authority.activeReleasePathInstanceDigest,
      expected.value.activeReleasePathInstanceDigest,
    ],
    [
      "authority.activeReleaseTipDigest",
      authority.activeReleaseTipDigest,
      expected.value.activeReleaseTipDigest,
    ],
    [
      "authority.activeReleaseValueDigest",
      authority.activeReleaseValueDigest,
      expected.value.activeReleaseValueDigest,
    ],
    [
      "authority.activeReleaseReceiptDigest",
      authority.activeReleaseReceiptDigest,
      expected.value.activeReleaseReceiptDigest,
    ],
    ["absence.destinationDigest", missing.destinationDigest, a.destinationDigest],
    ["absence.stateRootDigest", missing.stateRootDigest, a.stateRootDigest],
    ["absence.helperDigest", missing.helperDigest, a.helperDigest],
    ["absence.custodyInstanceDigest", missing.custodyInstanceDigest, a.custodyInstanceDigest],
    ["globalIdentity.installationId", global.installationId, a.installationId],
    ["globalIdentity.projectId", global.projectId, a.projectId],
    ["globalIdentity.stateRootDigest", global.stateRootDigest, a.stateRootDigest],
    ["globalIdentity.custodyInstanceDigest", global.custodyInstanceDigest, a.custodyInstanceDigest],
    ["globalIdentity.authorityPath", global.authorityPath, stateMutationAuthorityPath],
    ["globalIdentity.authorityPathInstanceDigest", global.authorityPathInstanceDigest, dp],
  ] as const)
    if (actual !== selected) issues.push(`${field}:mismatch`);

  if (av.lifecycle !== "ACTIVE") issues.push("anchorValue:lifecycle-not-active");
  if (ov.lifecycle !== "ACTIVE") issues.push("ownerValue:lifecycle-not-active");
  if (missing.reason !== "RUNTIME_AUTHORITY_ABSENT")
    issues.push("absence.reason:not-runtime-authority-absent");
  if (String(missing.observedAt) < String(i.startedAt))
    issues.push("absence.observedAt:before-intent");
  if (String(missing.observedAt) >= String(i.expiresAt))
    issues.push("absence.observedAt:at-or-after-expiry");
  if (
    operationRecord.operationKind !== "BOOTSTRAP_INSTALL" ||
    operationRecord.bootstrapTransactionId !== a.bootstrapTransactionId ||
    operationRecord.bootstrapGrantDigest !== a.bootstrapGrantDigest ||
    operationRecord.reviewedInstallerDigest !== a.reviewedInstallerDigest ||
    operationRecord.independentReviewReceiptDigest !== a.independentReviewReceiptDigest
  )
    issues.push("reviewedOperation:not-anchor-bootstrap");
  if (sc.operationKind !== "BOOTSTRAP_INSTALL" || sc.successorAuthorityOrdinal !== "0")
    issues.push("successorCore:not-genesis");
  if (h.recordKind !== "GENESIS" || h.ordinal !== "0" || h.predecessorKind !== "GENESIS_LITERAL")
    issues.push("historyRecord:not-genesis");
  if (
    authority.authorityOrdinal !== "0" ||
    authority.headOrdinal !== "0" ||
    authority.priorAuthorityTipDigest !== null ||
    authority.priorAuthorityValueDigest !== null ||
    authority.priorAuthorityReceiptDigest !== null
  )
    issues.push("authorityValue:not-genesis");
  return Object.freeze([...new Set(issues)].sort());
}

export function validateBootstrapGenesisPostSelectionBinding(
  postInput: unknown,
  coreInput: unknown,
  anchorInput: unknown,
  authorityValueInput: unknown,
  proposalInput: unknown,
  tipInput: unknown,
  expectedInput: unknown,
): readonly string[] {
  const post = parseBootstrapGenesisPostSelection(postInput);
  const core = parseBootstrapGenesisCore(coreInput);
  const anchor = parseBootstrapAnchor(anchorInput);
  const authority = parseStateMutationAuthorityValue(authorityValueInput);
  const proposal = parsePointerProposal(proposalInput);
  const tip = parsePointerCurrentTip(tipInput);
  const expected = snapshotClosedRecord(expectedInput, postExpectationFields);
  const issues = [
    ...prefixed("post", post),
    ...prefixed("core", core),
    ...prefixed("anchor", anchor),
    ...prefixed("authorityValue", authority),
    ...prefixed("proposal", proposal),
    ...prefixed("tip", tip),
    ...(expected.ok ? [] : expected.issues.map((issue) => `expected:${issue}`)),
  ];
  if (
    !post.ok ||
    !core.ok ||
    !anchor.ok ||
    !authority.ok ||
    !proposal.ok ||
    !tip.ok ||
    !expected.ok
  )
    return Object.freeze([...new Set(issues)].sort());
  for (const field of postExpectationFields)
    if (!isSha256(expected.value[field])) issues.push(`expected:${field}:invalid`);
  if (issues.length > 0) return Object.freeze([...new Set(issues)].sort());
  const p = post.value;
  const c = core.value;
  const a = anchor.value;
  const value = authority.value;
  const proposalRecord = proposal.value;
  const tipRecord = tip.value;
  let anchorDigest: string;
  try {
    anchorDigest = computeBootstrapAnchorDigest(a);
  } catch {
    issues.push("anchor:globalBootstrapIdentityDigest:mismatch");
    return Object.freeze([...new Set(issues)].sort());
  }
  const dp = computePointerInstanceDigest(authorityIdentity(a));
  const dv = computePointerValueDigest("STATE_MUTATION_AUTHORITY_ROTATION", dp, value);
  const dr = computeProposalReceiptDigest(proposalRecord);
  const dt = computeCurrentTipDigest(tipRecord);
  const coreDigest = computeBootstrapGenesisCoreDigest(c);
  const positionDigest = computePointerPositionDigest("STATE_MUTATION_AUTHORITY_ROTATION", {
    mode: "VALUE",
    parts: {},
  });
  const mutationId = computeMutationId({
    ...authorityIdentity(a),
    priorTipDigest: null,
    priorValueDigest: null,
    priorReceiptDigest: null,
    successorValueDigest: dv,
    outcome: "SELECT",
  });
  for (const [field, actual, selected] of [
    ["expected.anchorDigest", expected.value.anchorDigest, anchorDigest],
    ["expected.authorityPathInstanceDigest", expected.value.authorityPathInstanceDigest, dp],
    ["expected.bootstrapGenesisCoreDigest", expected.value.bootstrapGenesisCoreDigest, coreDigest],
    ["anchorDigest", p.anchorDigest, anchorDigest],
    ["authorityPathInstanceDigest", p.authorityPathInstanceDigest, dp],
    ["bootstrapGenesisCoreDigest", p.bootstrapGenesisCoreDigest, coreDigest],
    ["valueDigest", p.valueDigest, dv],
    ["receiptDigest", p.receiptDigest, dr],
    ["tipDigest", p.tipDigest, dt],
    ["valueReadbackDigest", p.valueReadbackDigest, canonicalDigest(value)],
    ["proposalReadbackDigest", p.proposalReadbackDigest, canonicalDigest(proposalRecord)],
    ["tipReadbackDigest", p.tipReadbackDigest, canonicalDigest(tipRecord)],
    ["core.anchorDigest", c.anchorDigest, anchorDigest],
    ["core.authorityPathInstanceDigest", c.authorityPathInstanceDigest, dp],
    ["core.authorityValueDigest", c.authorityValueDigest, dv],
    ["core.genesisPositionDigest", c.genesisPositionDigest, positionDigest],
    ["proposal.pathInstanceDigest", proposalRecord.pathInstanceDigest, dp],
    ["proposal.successorValueDigest", proposalRecord.successorValueDigest, dv],
    ["proposal.positionDigest", proposalRecord.positionDigest, positionDigest],
    ["proposal.mutationId", proposalRecord.mutationId, mutationId],
    ["proposal.producerDigest", proposalRecord.producerDigest, coreDigest],
    ["tip.pathInstanceDigest", tipRecord.pathInstanceDigest, dp],
    ["tip.valueDigest", tipRecord.valueDigest, dv],
    ["tip.proposalReceiptDigest", tipRecord.proposalReceiptDigest, dr],
  ] as const)
    if (actual !== selected) issues.push(`${field}:mismatch`);
  if (
    proposalRecord.pointerKind !== "STATE_MUTATION_AUTHORITY_ROTATION" ||
    proposalRecord.producerKind !== "REVIEWED_BOOTSTRAP_GENESIS" ||
    proposalRecord.intent !== "VALUE_PROPOSED" ||
    proposalRecord.outcome !== "SELECT" ||
    proposalRecord.priorTipDigest !== null ||
    proposalRecord.priorValueDigest !== null ||
    proposalRecord.priorReceiptDigest !== null ||
    proposalRecord.authorityEpochTipDigest !== null ||
    proposalRecord.authorityEpochValueDigest !== null ||
    proposalRecord.authorityEpochReceiptDigest !== null
  )
    issues.push("proposal:not-reviewed-bootstrap-genesis");
  if (tipRecord.pointerKind !== "STATE_MUTATION_AUTHORITY_ROTATION")
    issues.push("tip:pointerKind:mismatch");
  if (String(p.observedAt) < String(proposalRecord.proposedAt))
    issues.push("observedAt:before-proposal");
  return Object.freeze([...new Set(issues)].sort());
}

export function parseBootstrapGenesisContract(
  expectedSchemaVersion: string,
  input: unknown,
): ParseResult | undefined {
  if (expectedSchemaVersion === "state-mutation-bootstrap-genesis-core/v1")
    return parseBootstrapGenesisCore(input);
  if (expectedSchemaVersion === "state-mutation-bootstrap-genesis-post-selection-receipt/v1")
    return parseBootstrapGenesisPostSelection(input);
  return undefined;
}

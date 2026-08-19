import {
  computeBootstrapAnchorDigest,
  computeBootstrapAnchorMutationId,
  computeBootstrapAnchorProposalDigest,
  computeBootstrapAnchorTipDigest,
  computeBootstrapAnchorValueDigest,
  parseBootstrapAnchor,
  parseBootstrapAnchorLifecycleValue,
  parseBootstrapAnchorProposal,
  parseBootstrapAnchorTip,
} from "./anchor.js";
import {
  computeDestinationOwnerProposalDigest,
  computeDestinationOwnerMutationId,
  computeDestinationOwnerPositionDigest,
  computeDestinationOwnerTipDigest,
  computeDestinationOwnerValueDigest,
  parseDestinationOwnerProposal,
  parseDestinationOwnerTip,
  parseDestinationOwnerValue,
} from "./owner.js";
import {
  computeDestinationOwnerSuccessorPostSelectionDigest,
  parseDestinationOwnerSuccessorPostSelection,
} from "./successor.js";
import {
  canonicalJson,
  frame,
  framedDigest,
  isCanonicalTimestamp,
  isSha256,
  isUuidV7,
  snapshotClosedRecord,
  type ContractRecord,
  type ParseResult,
} from "./runtime.js";

const proposedGenesisFields = Object.freeze([
  "authorityPathInstanceDigest",
  "bootstrapGrantDigest",
  "bootstrapTransactionId",
  "genesisPositionDigest",
  "globalIdentityDigest",
  "schemaVersion",
  "successorCoreDigest",
] as const);
const reviewedInstallerFields = Object.freeze([
  "installerArtifactDigest",
  "installerSourceDigest",
  "reviewReceiptDigest",
  "schemaVersion",
] as const);
const reviewedHelperFields = Object.freeze([
  "abiDigest",
  "helperDigest",
  "helperProfileDigest",
  "lockProfileDigest",
  "schemaVersion",
  "stateComponentProfileDigest",
] as const);
const useIntentFields = Object.freeze([
  "anchorActiveReceiptDigest",
  "anchorActiveTipDigest",
  "anchorActiveValueDigest",
  "anchorDigest",
  "bootstrapTransactionId",
  "custodyInstanceDigest",
  "destinationDigest",
  "destinationOwnerActiveReceiptDigest",
  "destinationOwnerActiveTipDigest",
  "destinationOwnerActiveValueDigest",
  "destinationStateRootDigest",
  "expiresAt",
  "proposedGenesisInput",
  "reviewedHelper",
  "reviewedInstaller",
  "schemaVersion",
  "startedAt",
] as const);
const expectationFields = Object.freeze([
  "anchorDigest",
  "bootstrapTransactionId",
  "custodyInstanceDigest",
  "destinationLockCustodyObservationDigest",
  "destinationDigest",
  "destinationStateRootDigest",
  "effectiveAt",
  "proposedGenesisInput",
  "reviewedHelper",
  "reviewedInstaller",
  "reviewedInstallerDigest",
  "successorPostSelectionReceiptDigest",
  "successorPostSelectionReceipt",
  "successorPostSelectionReceiptReadbackDigest",
  "successorPostSelectionReviewCoreDigest",
] as const);

export const bootstrapUseIntentSchemaFields = Object.freeze({
  proposedGenesis: proposedGenesisFields,
  reviewedHelper: reviewedHelperFields,
  reviewedInstaller: reviewedInstallerFields,
  useIntent: useIntentFields,
});
export const bootstrapUseIntentSchemaVersions = Object.freeze([
  "bootstrap-proposed-genesis-input/v1",
  "bootstrap-reviewed-helper/v1",
  "bootstrap-reviewed-installer/v1",
  "state-mutation-bootstrap-anchor-use-intent/v1",
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

function sameCanonical(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left as never) === canonicalJson(right as never);
  } catch {
    return false;
  }
}

export function parseBootstrapProposedGenesisInput(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, proposedGenesisFields);
  if (!parsed.ok) return parsed;
  const issues = digestIssues(parsed.value, [
    "authorityPathInstanceDigest",
    "bootstrapGrantDigest",
    "genesisPositionDigest",
    "globalIdentityDigest",
    "successorCoreDigest",
  ]);
  if (!isUuidV7(parsed.value.bootstrapTransactionId)) issues.push("bootstrapTransactionId:invalid");
  if (parsed.value.schemaVersion !== "bootstrap-proposed-genesis-input/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseBootstrapReviewedInstaller(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, reviewedInstallerFields);
  if (!parsed.ok) return parsed;
  const issues = digestIssues(parsed.value, [
    "installerArtifactDigest",
    "installerSourceDigest",
    "reviewReceiptDigest",
  ]);
  if (parsed.value.schemaVersion !== "bootstrap-reviewed-installer/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseBootstrapReviewedHelper(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, reviewedHelperFields);
  if (!parsed.ok) return parsed;
  const issues = digestIssues(parsed.value, [
    "abiDigest",
    "helperDigest",
    "helperProfileDigest",
    "lockProfileDigest",
    "stateComponentProfileDigest",
  ]);
  if (parsed.value.schemaVersion !== "bootstrap-reviewed-helper/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseBootstrapAnchorUseIntent(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, useIntentFields);
  if (!parsed.ok) return parsed;
  const proposed = parseBootstrapProposedGenesisInput(parsed.value.proposedGenesisInput);
  const installer = parseBootstrapReviewedInstaller(parsed.value.reviewedInstaller);
  const helper = parseBootstrapReviewedHelper(parsed.value.reviewedHelper);
  const issues = [
    ...digestIssues(parsed.value, [
      "anchorActiveReceiptDigest",
      "anchorActiveTipDigest",
      "anchorActiveValueDigest",
      "anchorDigest",
      "custodyInstanceDigest",
      "destinationDigest",
      "destinationOwnerActiveReceiptDigest",
      "destinationOwnerActiveTipDigest",
      "destinationOwnerActiveValueDigest",
      "destinationStateRootDigest",
    ]),
    ...prefixed("proposedGenesisInput", proposed),
    ...prefixed("reviewedInstaller", installer),
    ...prefixed("reviewedHelper", helper),
  ];
  if (!isUuidV7(parsed.value.bootstrapTransactionId)) issues.push("bootstrapTransactionId:invalid");
  for (const field of ["startedAt", "expiresAt"])
    if (!isCanonicalTimestamp(parsed.value[field])) issues.push(`${field}:invalid`);
  if (
    isCanonicalTimestamp(parsed.value.startedAt) &&
    isCanonicalTimestamp(parsed.value.expiresAt)
  ) {
    const started = Date.parse(String(parsed.value.startedAt));
    const expires = Date.parse(String(parsed.value.expiresAt));
    if (started >= expires) issues.push("expiresAt:not-after-startedAt");
    if (expires - started > 15 * 60 * 1000) issues.push("expiresAt:interval-over-15-minutes");
  }
  if (parsed.value.schemaVersion !== "state-mutation-bootstrap-anchor-use-intent/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? parsed : invalid(...issues);
}

function parsedOrThrow(parser: (input: unknown) => ParseResult, input: unknown): ContractRecord {
  const parsed = parser(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return parsed.value;
}

export function computeBootstrapAnchorUseIntentDigest(input: unknown): string {
  const intent = parsedOrThrow(parseBootstrapAnchorUseIntent, input);
  return framedDigest("bootstrap-anchor-use-intent/v1", [
    frame.raw32(String(intent.anchorDigest)),
    frame.raw32(String(intent.anchorActiveTipDigest)),
    frame.raw32(String(intent.anchorActiveValueDigest)),
    frame.raw32(String(intent.anchorActiveReceiptDigest)),
    frame.raw32(String(intent.destinationOwnerActiveTipDigest)),
    frame.raw32(String(intent.destinationOwnerActiveValueDigest)),
    frame.raw32(String(intent.destinationOwnerActiveReceiptDigest)),
    frame.text(String(intent.bootstrapTransactionId)),
    frame.raw32(String(intent.destinationStateRootDigest)),
    frame.raw32(String(intent.custodyInstanceDigest)),
    frame.canonical(intent.proposedGenesisInput!),
    frame.canonical(intent.reviewedInstaller!),
    frame.canonical(intent.reviewedHelper!),
    frame.text(String(intent.startedAt)),
    frame.text(String(intent.expiresAt)),
    frame.canonical(intent),
  ]);
}

export function validateBootstrapAnchorUseIntentBinding(
  intentInput: unknown,
  anchorInput: unknown,
  anchorTipInput: unknown,
  anchorValueInput: unknown,
  anchorProposalInput: unknown,
  ownerTipInput: unknown,
  ownerValueInput: unknown,
  ownerProposalInput: unknown,
  expectedInput: unknown,
): readonly string[] {
  const intent = parseBootstrapAnchorUseIntent(intentInput);
  const anchor = parseBootstrapAnchor(anchorInput);
  const anchorTip = parseBootstrapAnchorTip(anchorTipInput);
  const anchorValue = parseBootstrapAnchorLifecycleValue(anchorValueInput);
  const anchorProposal = parseBootstrapAnchorProposal(anchorProposalInput);
  const ownerTip = parseDestinationOwnerTip(ownerTipInput);
  const ownerValue = parseDestinationOwnerValue(ownerValueInput);
  const ownerProposal = parseDestinationOwnerProposal(ownerProposalInput);
  const expected = snapshotClosedRecord(expectedInput, expectationFields);
  const expectedProposed = expected.ok
    ? parseBootstrapProposedGenesisInput(expected.value.proposedGenesisInput)
    : undefined;
  const expectedInstaller = expected.ok
    ? parseBootstrapReviewedInstaller(expected.value.reviewedInstaller)
    : undefined;
  const expectedHelper = expected.ok
    ? parseBootstrapReviewedHelper(expected.value.reviewedHelper)
    : undefined;
  const expectedPostSelection =
    expected.ok && expected.value.successorPostSelectionReceipt !== null
      ? parseDestinationOwnerSuccessorPostSelection(expected.value.successorPostSelectionReceipt)
      : undefined;
  const issues = [
    ...prefixed("intent", intent),
    ...prefixed("anchor", anchor),
    ...prefixed("anchorTip", anchorTip),
    ...prefixed("anchorValue", anchorValue),
    ...prefixed("anchorProposal", anchorProposal),
    ...prefixed("ownerTip", ownerTip),
    ...prefixed("ownerValue", ownerValue),
    ...prefixed("ownerProposal", ownerProposal),
    ...(expected.ok ? [] : expected.issues.map((issue) => `expected:${issue}`)),
    ...(expectedProposed ? prefixed("expected:proposedGenesisInput", expectedProposed) : []),
    ...(expectedInstaller ? prefixed("expected:reviewedInstaller", expectedInstaller) : []),
    ...(expectedHelper ? prefixed("expected:reviewedHelper", expectedHelper) : []),
    ...(expectedPostSelection
      ? prefixed("expected:successorPostSelectionReceipt", expectedPostSelection)
      : []),
  ];
  if (
    !intent.ok ||
    !anchor.ok ||
    !anchorTip.ok ||
    !anchorValue.ok ||
    !anchorProposal.ok ||
    !ownerTip.ok ||
    !ownerValue.ok ||
    !ownerProposal.ok ||
    !expected.ok ||
    !expectedProposed?.ok ||
    !expectedInstaller?.ok ||
    !expectedHelper?.ok ||
    (expected.value.successorPostSelectionReceipt !== null && !expectedPostSelection?.ok)
  )
    return Object.freeze([...new Set(issues)].sort());
  for (const field of [
    "anchorDigest",
    "custodyInstanceDigest",
    "destinationDigest",
    "destinationStateRootDigest",
    "reviewedInstallerDigest",
  ])
    if (!isSha256(expected.value[field])) issues.push(`expected:${field}:invalid`);
  if (!isUuidV7(expected.value.bootstrapTransactionId))
    issues.push("expected:bootstrapTransactionId:invalid");
  if (!isCanonicalTimestamp(expected.value.effectiveAt))
    issues.push("expected:effectiveAt:invalid");
  if (
    expected.value.destinationLockCustodyObservationDigest !== null &&
    !isSha256(expected.value.destinationLockCustodyObservationDigest)
  )
    issues.push("expected:destinationLockCustodyObservationDigest:invalid");
  if (
    expected.value.successorPostSelectionReceiptDigest !== null &&
    !isSha256(expected.value.successorPostSelectionReceiptDigest)
  )
    issues.push("expected:successorPostSelectionReceiptDigest:invalid");
  if (
    expected.value.successorPostSelectionReceiptReadbackDigest !== null &&
    !isSha256(expected.value.successorPostSelectionReceiptReadbackDigest)
  )
    issues.push("expected:successorPostSelectionReceiptReadbackDigest:invalid");
  if (
    expected.value.successorPostSelectionReviewCoreDigest !== null &&
    !isSha256(expected.value.successorPostSelectionReviewCoreDigest)
  )
    issues.push("expected:successorPostSelectionReviewCoreDigest:invalid");
  const i = intent.value;
  const a = anchor.value;
  const at = anchorTip.value;
  const av = anchorValue.value;
  const ap = anchorProposal.value;
  const ot = ownerTip.value;
  const ov = ownerValue.value;
  const op = ownerProposal.value;
  let anchorDigest: string;
  try {
    anchorDigest = computeBootstrapAnchorDigest(a);
  } catch {
    issues.push("anchor:globalBootstrapIdentityDigest:mismatch");
    return Object.freeze([...new Set(issues)].sort());
  }
  const anchorTipDigest = computeBootstrapAnchorTipDigest(at);
  const anchorValueDigest = computeBootstrapAnchorValueDigest(av);
  const anchorProposalDigest = computeBootstrapAnchorProposalDigest(ap);
  const ownerTipDigest = computeDestinationOwnerTipDigest(ot);
  const ownerValueDigest = computeDestinationOwnerValueDigest(ov);
  const ownerProposalDigest = computeDestinationOwnerProposalDigest(op);
  for (const [field, actual, selected] of [
    ["anchorDigest", i.anchorDigest, anchorDigest],
    ["expected.anchorDigest", expected.value.anchorDigest, anchorDigest],
    ["anchorActiveTipDigest", i.anchorActiveTipDigest, anchorTipDigest],
    ["anchorActiveValueDigest", i.anchorActiveValueDigest, anchorValueDigest],
    ["anchorActiveReceiptDigest", i.anchorActiveReceiptDigest, anchorProposalDigest],
    ["anchorTip.valueDigest", at.valueDigest, anchorValueDigest],
    ["anchorTip.proposalReceiptDigest", at.proposalReceiptDigest, anchorProposalDigest],
    ["anchorTip.anchorDigest", at.anchorDigest, anchorDigest],
    ["anchorValue.anchorDigest", av.anchorDigest, anchorDigest],
    ["anchorProposal.anchorDigest", ap.anchorDigest, anchorDigest],
    ["anchorProposal.successorValueDigest", ap.successorValueDigest, anchorValueDigest],
    ["anchorProposal.mutationId", ap.mutationId, computeBootstrapAnchorMutationId(a, ap, av)],
    ["destinationOwnerActiveTipDigest", i.destinationOwnerActiveTipDigest, ownerTipDigest],
    ["destinationOwnerActiveValueDigest", i.destinationOwnerActiveValueDigest, ownerValueDigest],
    [
      "destinationOwnerActiveReceiptDigest",
      i.destinationOwnerActiveReceiptDigest,
      ownerProposalDigest,
    ],
    ["ownerTip.valueDigest", ot.valueDigest, ownerValueDigest],
    ["ownerTip.proposalReceiptDigest", ot.proposalReceiptDigest, ownerProposalDigest],
    ["ownerTip.destinationDigest", ot.destinationDigest, a.destinationDigest],
    ["ownerProposal.successorValueDigest", op.successorValueDigest, ownerValueDigest],
    ["ownerProposal.mutationId", op.mutationId, computeDestinationOwnerMutationId(op, ov)],
    ["ownerProposal.destinationDigest", op.destinationDigest, a.destinationDigest],
    [
      "ownerProposal.positionDigest",
      op.positionDigest,
      computeDestinationOwnerPositionDigest(String(a.destinationDigest)),
    ],
    ["ownerValue.anchorDigest", ov.anchorDigest, anchorDigest],
    ["ownerValue.installationId", ov.installationId, a.installationId],
    ["ownerValue.destinationDigest", ov.destinationDigest, a.destinationDigest],
    [
      "ownerValue.successorReviewCoreDigest",
      ov.successorReviewCoreDigest,
      a.successorReviewCoreDigest,
    ],
    ["bootstrapTransactionId", i.bootstrapTransactionId, expected.value.bootstrapTransactionId],
    ["bootstrapTransactionId:anchor", i.bootstrapTransactionId, a.bootstrapTransactionId],
    ["destinationDigest", i.destinationDigest, expected.value.destinationDigest],
    ["destinationDigest:anchor", i.destinationDigest, a.destinationDigest],
    [
      "destinationStateRootDigest",
      i.destinationStateRootDigest,
      expected.value.destinationStateRootDigest,
    ],
    ["destinationStateRootDigest:anchor", i.destinationStateRootDigest, a.stateRootDigest],
    ["custodyInstanceDigest", i.custodyInstanceDigest, expected.value.custodyInstanceDigest],
    ["custodyInstanceDigest:anchor", i.custodyInstanceDigest, a.custodyInstanceDigest],
    [
      "reviewedInstallerDigest:anchor",
      expected.value.reviewedInstallerDigest,
      a.reviewedInstallerDigest,
    ],
  ] as const)
    if (actual !== selected) issues.push(`${field}:mismatch`);
  if (av.lifecycle !== "ACTIVE") issues.push("anchorValue:lifecycle-not-active");
  if (ov.lifecycle !== "ACTIVE") issues.push("ownerValue:lifecycle-not-active");
  if (
    ap.transition !== "ACTIVATE" ||
    ap.source !== "BOOTSTRAP_CREATE" ||
    ap.transitionEvidenceDigest !== a.bootstrapGrantDigest ||
    ap.priorTipDigest !== null ||
    ap.priorValueDigest !== null ||
    ap.priorReceiptDigest !== null
  )
    issues.push("anchorProposal:not-initial-activation");
  if (!sameCanonical(i.proposedGenesisInput, expected.value.proposedGenesisInput))
    issues.push("proposedGenesisInput:expected-mismatch");
  if (!sameCanonical(i.reviewedInstaller, expected.value.reviewedInstaller))
    issues.push("reviewedInstaller:expected-mismatch");
  if (!sameCanonical(i.reviewedHelper, expected.value.reviewedHelper))
    issues.push("reviewedHelper:expected-mismatch");
  const proposed = i.proposedGenesisInput as ContractRecord;
  const helper = i.reviewedHelper as ContractRecord;
  const installer = i.reviewedInstaller as ContractRecord;
  for (const [field, actual, selected] of [
    [
      "proposed.authorityPathInstanceDigest",
      proposed.authorityPathInstanceDigest,
      a.authorityPathInstanceDigest,
    ],
    ["proposed.bootstrapGrantDigest", proposed.bootstrapGrantDigest, a.bootstrapGrantDigest],
    ["proposed.bootstrapTransactionId", proposed.bootstrapTransactionId, a.bootstrapTransactionId],
    [
      "installer.installerArtifactDigest",
      installer.installerArtifactDigest,
      a.reviewedInstallerDigest,
    ],
    [
      "installer.reviewReceiptDigest",
      installer.reviewReceiptDigest,
      a.independentReviewReceiptDigest,
    ],
    ["helper.abiDigest", helper.abiDigest, a.abiDigest],
    ["helper.helperDigest", helper.helperDigest, a.helperDigest],
    ["helper.helperProfileDigest", helper.helperProfileDigest, a.helperProfileDigest],
    ["helper.lockProfileDigest", helper.lockProfileDigest, a.lockProfileDigest],
    [
      "helper.stateComponentProfileDigest",
      helper.stateComponentProfileDigest,
      a.stateComponentProfileDigest,
    ],
  ] as const)
    if (actual !== selected) issues.push(`${field}:mismatch`);
  const effectiveAt = String(expected.value.effectiveAt);
  if (isCanonicalTimestamp(expected.value.effectiveAt)) {
    if (effectiveAt < String(i.startedAt)) issues.push("effectiveAt:before-startedAt");
    if (effectiveAt >= String(i.expiresAt)) issues.push("effectiveAt:at-or-after-expiry");
  }
  if (a.successorReviewCoreDigest === null) {
    if (expected.value.successorPostSelectionReceiptDigest !== null)
      issues.push("successorPostSelectionReceiptDigest:genesis-forbidden");
    if (expected.value.successorPostSelectionReviewCoreDigest !== null)
      issues.push("successorPostSelectionReviewCoreDigest:genesis-forbidden");
    if (expected.value.successorPostSelectionReceipt !== null)
      issues.push("successorPostSelectionReceipt:genesis-forbidden");
    if (expected.value.successorPostSelectionReceiptReadbackDigest !== null)
      issues.push("successorPostSelectionReceiptReadbackDigest:genesis-forbidden");
    if (expected.value.destinationLockCustodyObservationDigest !== null)
      issues.push("destinationLockCustodyObservationDigest:genesis-forbidden");
    if (
      op.transition !== "ACTIVATE_GENESIS" ||
      op.source !== "BOOTSTRAP_GENESIS" ||
      op.transitionEvidenceDigest !== a.bootstrapGrantDigest ||
      op.priorTipDigest !== null ||
      op.priorValueDigest !== null ||
      op.priorReceiptDigest !== null
    )
      issues.push("ownerProposal:not-genesis-activation");
  } else {
    if (expected.value.successorPostSelectionReceiptDigest === null)
      issues.push("successorPostSelectionReceiptDigest:successor-required");
    if (expected.value.successorPostSelectionReviewCoreDigest !== a.successorReviewCoreDigest)
      issues.push("successorPostSelectionReviewCoreDigest:mismatch");
    if (!expectedPostSelection?.ok) {
      issues.push("successorPostSelectionReceipt:successor-required");
    } else {
      const post = expectedPostSelection.value;
      const postDigest = computeDestinationOwnerSuccessorPostSelectionDigest(post);
      for (const [field, actual, selected] of [
        [
          "successorPostSelectionReceiptDigest",
          expected.value.successorPostSelectionReceiptDigest,
          postDigest,
        ],
        [
          "successorPostSelection.reviewCoreDigest",
          post.reviewCoreDigest,
          a.successorReviewCoreDigest,
        ],
        ["successorPostSelection.successorAnchorDigest", post.successorAnchorDigest, anchorDigest],
        [
          "successorPostSelection.successorOwnerTipDigest",
          post.successorOwnerTipDigest,
          ownerTipDigest,
        ],
        [
          "successorPostSelection.successorOwnerValueDigest",
          post.successorOwnerValueDigest,
          ownerValueDigest,
        ],
        [
          "successorPostSelection.successorOwnerProposalReceiptDigest",
          post.successorOwnerProposalReceiptDigest,
          ownerProposalDigest,
        ],
        [
          "successorPostSelection.destinationLockCustodyObservationDigest",
          post.destinationLockCustodyObservationDigest,
          expected.value.destinationLockCustodyObservationDigest,
        ],
      ] as const)
        if (actual !== selected) issues.push(`${field}:mismatch`);
    }
    if (expected.value.successorPostSelectionReceiptReadbackDigest === null)
      issues.push("successorPostSelectionReceiptReadbackDigest:successor-required");
    if (expected.value.destinationLockCustodyObservationDigest === null)
      issues.push("destinationLockCustodyObservationDigest:successor-required");
    if (
      op.transition !== "ACTIVATE_SUCCESSOR" ||
      op.source !== "SUCCESSOR_REVIEW" ||
      op.transitionEvidenceDigest !== a.successorReviewCoreDigest ||
      op.priorTipDigest === null ||
      op.priorValueDigest === null ||
      op.priorReceiptDigest === null
    )
      issues.push("ownerProposal:not-successor-activation");
  }
  return Object.freeze([...new Set(issues)].sort());
}

export function parseBootstrapUseIntentContract(
  expectedSchemaVersion: string,
  input: unknown,
): ParseResult | undefined {
  if (expectedSchemaVersion === "bootstrap-proposed-genesis-input/v1")
    return parseBootstrapProposedGenesisInput(input);
  if (expectedSchemaVersion === "bootstrap-reviewed-installer/v1")
    return parseBootstrapReviewedInstaller(input);
  if (expectedSchemaVersion === "bootstrap-reviewed-helper/v1")
    return parseBootstrapReviewedHelper(input);
  if (expectedSchemaVersion === "state-mutation-bootstrap-anchor-use-intent/v1")
    return parseBootstrapAnchorUseIntent(input);
  return undefined;
}

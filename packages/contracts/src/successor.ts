import {
  computeDestinationOwnerMutationId,
  computeDestinationOwnerPositionDigest,
  computeDestinationOwnerProposalDigest,
  computeDestinationOwnerTeardownArchiveDigest,
  computeDestinationOwnerTipDigest,
  computeDestinationOwnerValueDigest,
  parseDestinationOwnerProposal,
  parseDestinationOwnerTeardownArchive,
  parseDestinationOwnerTip,
  parseDestinationOwnerValue,
  validateDestinationOwnerMutationBinding,
} from "./owner.js";
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

const priorInstallationFields = Object.freeze([
  "anchorDigest",
  "anchorRetiredReceiptDigest",
  "anchorRetiredTipDigest",
  "anchorRetiredValueDigest",
  "installationId",
  "projectId",
  "schemaVersion",
  "stateRootDigest",
] as const);
const successorAuthorityFields = Object.freeze([
  "bootstrapGrantDigest",
  "bootstrapTransactionId",
  "globalBootstrapIdentityDigest",
  "installationId",
  "projectId",
  "reviewedInstallerDigest",
  "reviewedReleaseManifestDigest",
  "reviewedReleaseSubjectDigest",
  "schemaVersion",
  "stateRootDigest",
] as const);
const independentReviewFields = Object.freeze([
  "authorIdentityDigest",
  "candidateDigest",
  "reviewReceiptDigest",
  "reviewedAt",
  "reviewerIdentityDigest",
  "schemaVersion",
] as const);
const reviewCoreFields = Object.freeze([
  "destinationDigest",
  "independentReview",
  "priorInstallation",
  "priorRetiredReceiptDigest",
  "priorRetiredTipDigest",
  "priorRetiredValueDigest",
  "schemaVersion",
  "successorAuthority",
  "teardownArchiveDigest",
] as const);
const postSelectionFields = Object.freeze([
  "destinationLockCustodyObservationDigest",
  "observedAt",
  "proposalReadbackDigest",
  "reviewCoreDigest",
  "schemaVersion",
  "successorAnchorDigest",
  "successorOwnerProposalReceiptDigest",
  "successorOwnerTipDigest",
  "successorOwnerValueDigest",
  "tipReadbackDigest",
  "valueReadbackDigest",
] as const);
const reviewExpectationFields = Object.freeze([
  "authorIdentityDigest",
  "destinationDigest",
  "priorProjectId",
  "priorStateRootDigest",
  "reviewReceiptDigest",
  "reviewerIdentityDigest",
  "successorAuthority",
  "teardownAbsenceDigest",
] as const);
const postExpectationFields = Object.freeze([
  "destinationLockCustodyObservationDigest",
  "observationDigest",
  "proposalReadbackDigest",
  "successorAnchorDigest",
  "tipReadbackDigest",
  "valueReadbackDigest",
] as const);

export const successorReviewSchemaFields = Object.freeze({
  independentReview: independentReviewFields,
  postSelection: postSelectionFields,
  priorInstallation: priorInstallationFields,
  reviewCore: reviewCoreFields,
  successorAuthority: successorAuthorityFields,
});
export const successorReviewSchemaVersions = Object.freeze([
  "destination-owner-independent-review/v1",
  "destination-owner-prior-installation/v1",
  "destination-owner-successor-authority/v1",
  "state-mutation-destination-owner-successor-review-core/v1",
  "state-mutation-destination-owner-successor-review-post-selection-receipt/v1",
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

export function parseDestinationOwnerPriorInstallation(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, priorInstallationFields);
  if (!parsed.ok) return parsed;
  const issues = digestIssues(parsed.value, [
    "anchorDigest",
    "anchorRetiredReceiptDigest",
    "anchorRetiredTipDigest",
    "anchorRetiredValueDigest",
    "stateRootDigest",
  ]);
  if (!isUuidV7(parsed.value.installationId)) issues.push("installationId:invalid");
  if (!isUuidV7(parsed.value.projectId)) issues.push("projectId:invalid");
  if (parsed.value.schemaVersion !== "destination-owner-prior-installation/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseDestinationOwnerSuccessorAuthority(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, successorAuthorityFields);
  if (!parsed.ok) return parsed;
  const issues = digestIssues(parsed.value, [
    "bootstrapGrantDigest",
    "globalBootstrapIdentityDigest",
    "reviewedInstallerDigest",
    "reviewedReleaseManifestDigest",
    "reviewedReleaseSubjectDigest",
    "stateRootDigest",
  ]);
  for (const field of ["bootstrapTransactionId", "installationId", "projectId"])
    if (!isUuidV7(parsed.value[field])) issues.push(`${field}:invalid`);
  if (parsed.value.schemaVersion !== "destination-owner-successor-authority/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseDestinationOwnerIndependentReview(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, independentReviewFields);
  if (!parsed.ok) return parsed;
  const issues = digestIssues(parsed.value, [
    "authorIdentityDigest",
    "candidateDigest",
    "reviewReceiptDigest",
    "reviewerIdentityDigest",
  ]);
  if (!isCanonicalTimestamp(parsed.value.reviewedAt)) issues.push("reviewedAt:invalid");
  if (parsed.value.authorIdentityDigest === parsed.value.reviewerIdentityDigest)
    issues.push("reviewerIdentityDigest:author-equal");
  if (parsed.value.schemaVersion !== "destination-owner-independent-review/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseDestinationOwnerSuccessorReviewCore(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, reviewCoreFields);
  if (!parsed.ok) return parsed;
  const prior = parseDestinationOwnerPriorInstallation(parsed.value.priorInstallation);
  const authority = parseDestinationOwnerSuccessorAuthority(parsed.value.successorAuthority);
  const review = parseDestinationOwnerIndependentReview(parsed.value.independentReview);
  const issues = [
    ...digestIssues(parsed.value, [
      "destinationDigest",
      "priorRetiredReceiptDigest",
      "priorRetiredTipDigest",
      "priorRetiredValueDigest",
      "teardownArchiveDigest",
    ]),
    ...prefixed("priorInstallation", prior),
    ...prefixed("successorAuthority", authority),
    ...prefixed("independentReview", review),
  ];
  if (parsed.value.schemaVersion !== "state-mutation-destination-owner-successor-review-core/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function parseDestinationOwnerSuccessorPostSelection(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, postSelectionFields);
  if (!parsed.ok) return parsed;
  const issues = digestIssues(parsed.value, [
    "destinationLockCustodyObservationDigest",
    "proposalReadbackDigest",
    "reviewCoreDigest",
    "successorAnchorDigest",
    "successorOwnerProposalReceiptDigest",
    "successorOwnerTipDigest",
    "successorOwnerValueDigest",
    "tipReadbackDigest",
    "valueReadbackDigest",
  ]);
  if (!isCanonicalTimestamp(parsed.value.observedAt)) issues.push("observedAt:invalid");
  if (
    parsed.value.schemaVersion !==
    "state-mutation-destination-owner-successor-review-post-selection-receipt/v1"
  )
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? parsed : invalid(...issues);
}

function parsedOrThrow(parser: (input: unknown) => ParseResult, input: unknown): ContractRecord {
  const parsed = parser(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return parsed.value;
}

export function computeDestinationOwnerSuccessorReviewCandidateDigest(input: unknown): string {
  const core = parsedOrThrow(parseDestinationOwnerSuccessorReviewCore, input);
  return framedDigest("destination-owner-successor-review-candidate/v1", [
    frame.raw32(String(core.destinationDigest)),
    frame.raw32(String(core.priorRetiredTipDigest)),
    frame.raw32(String(core.priorRetiredValueDigest)),
    frame.raw32(String(core.priorRetiredReceiptDigest)),
    frame.raw32(String(core.teardownArchiveDigest)),
    frame.canonical(core.priorInstallation!),
    frame.canonical(core.successorAuthority!),
  ]);
}

export function computeDestinationOwnerSuccessorReviewCoreDigest(input: unknown): string {
  const core = parsedOrThrow(parseDestinationOwnerSuccessorReviewCore, input);
  const authority = core.successorAuthority as ContractRecord;
  return framedDigest("destination-owner-successor-review-core/v1", [
    frame.raw32(String(core.destinationDigest)),
    frame.raw32(String(core.priorRetiredTipDigest)),
    frame.raw32(String(core.priorRetiredValueDigest)),
    frame.raw32(String(core.priorRetiredReceiptDigest)),
    frame.raw32(String(core.teardownArchiveDigest)),
    frame.canonical(core.priorInstallation!),
    frame.text(String(authority.installationId)),
    frame.canonical(core.successorAuthority!),
    frame.canonical(core.independentReview!),
    frame.canonical(core),
  ]);
}

export function computeDestinationOwnerSuccessorPostSelectionDigest(input: unknown): string {
  const receipt = parsedOrThrow(parseDestinationOwnerSuccessorPostSelection, input);
  return framedDigest("destination-owner-successor-review-post-selection-receipt/v1", [
    frame.raw32(String(receipt.reviewCoreDigest)),
    frame.raw32(String(receipt.successorAnchorDigest)),
    frame.raw32(String(receipt.successorOwnerValueDigest)),
    frame.raw32(String(receipt.successorOwnerProposalReceiptDigest)),
    frame.raw32(String(receipt.successorOwnerTipDigest)),
    frame.raw32(String(receipt.valueReadbackDigest)),
    frame.raw32(String(receipt.proposalReadbackDigest)),
    frame.raw32(String(receipt.tipReadbackDigest)),
    frame.raw32(String(receipt.destinationLockCustodyObservationDigest)),
    frame.canonical(receipt),
  ]);
}

function sameCanonical(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left as never) === canonicalJson(right as never);
  } catch {
    return false;
  }
}

export function validateDestinationOwnerSuccessorReviewCoreBinding(
  coreInput: unknown,
  priorTipInput: unknown,
  priorValueInput: unknown,
  priorProposalInput: unknown,
  teardownArchiveInput: unknown,
  expectedInput: unknown,
): readonly string[] {
  const core = parseDestinationOwnerSuccessorReviewCore(coreInput);
  const priorTip = parseDestinationOwnerTip(priorTipInput);
  const priorValue = parseDestinationOwnerValue(priorValueInput);
  const priorProposal = parseDestinationOwnerProposal(priorProposalInput);
  const archive = parseDestinationOwnerTeardownArchive(teardownArchiveInput);
  const expected = snapshotClosedRecord(expectedInput, reviewExpectationFields);
  const expectedAuthority = expected.ok
    ? parseDestinationOwnerSuccessorAuthority(expected.value.successorAuthority)
    : undefined;
  const issues = [
    ...prefixed("core", core),
    ...prefixed("priorTip", priorTip),
    ...prefixed("priorValue", priorValue),
    ...prefixed("priorProposal", priorProposal),
    ...prefixed("teardownArchive", archive),
    ...(expected.ok ? [] : expected.issues.map((issue) => `expected:${issue}`)),
    ...(expectedAuthority ? prefixed("expected:successorAuthority", expectedAuthority) : []),
  ];
  if (
    !core.ok ||
    !priorTip.ok ||
    !priorValue.ok ||
    !priorProposal.ok ||
    !archive.ok ||
    !expected.ok ||
    !expectedAuthority?.ok
  )
    return Object.freeze([...new Set(issues)].sort());
  for (const field of [
    "authorIdentityDigest",
    "destinationDigest",
    "priorStateRootDigest",
    "reviewReceiptDigest",
    "reviewerIdentityDigest",
    "teardownAbsenceDigest",
  ])
    if (!isSha256(expected.value[field])) issues.push(`expected:${field}:invalid`);
  if (!isUuidV7(expected.value.priorProjectId)) issues.push("expected:priorProjectId:invalid");
  const c = core.value;
  const pt = priorTip.value;
  const pv = priorValue.value;
  const pp = priorProposal.value;
  const a = archive.value;
  const pi = c.priorInstallation as ContractRecord;
  const sa = c.successorAuthority as ContractRecord;
  const review = c.independentReview as ContractRecord;
  const tipDigest = computeDestinationOwnerTipDigest(pt);
  const valueDigest = computeDestinationOwnerValueDigest(pv);
  const proposalDigest = computeDestinationOwnerProposalDigest(pp);
  const archiveDigest = computeDestinationOwnerTeardownArchiveDigest(a);
  for (const [field, actual, selected] of [
    ["destinationDigest", c.destinationDigest, expected.value.destinationDigest],
    ["priorRetiredTipDigest", c.priorRetiredTipDigest, tipDigest],
    ["priorRetiredValueDigest", c.priorRetiredValueDigest, valueDigest],
    ["priorRetiredReceiptDigest", c.priorRetiredReceiptDigest, proposalDigest],
    ["teardownArchiveDigest", c.teardownArchiveDigest, archiveDigest],
    ["priorTip.valueDigest", pt.valueDigest, valueDigest],
    ["priorTip.proposalReceiptDigest", pt.proposalReceiptDigest, proposalDigest],
    ["priorProposal.successorValueDigest", pp.successorValueDigest, valueDigest],
    [
      "priorProposal.positionDigest",
      pp.positionDigest,
      computeDestinationOwnerPositionDigest(String(c.destinationDigest)),
    ],
    ["priorProposal.mutationId", pp.mutationId, computeDestinationOwnerMutationId(pp, pv)],
    ["priorValue.destinationDigest", pv.destinationDigest, c.destinationDigest],
    ["priorTip.destinationDigest", pt.destinationDigest, c.destinationDigest],
    ["priorProposal.destinationDigest", pp.destinationDigest, c.destinationDigest],
    ["priorInstallation.installationId", pi.installationId, pv.installationId],
    ["priorInstallation.anchorDigest", pi.anchorDigest, pv.anchorDigest],
    ["priorInstallation.anchorRetiredTipDigest", pi.anchorRetiredTipDigest, pv.anchorTipDigest],
    [
      "priorInstallation.anchorRetiredValueDigest",
      pi.anchorRetiredValueDigest,
      pv.anchorValueDigest,
    ],
    [
      "priorInstallation.anchorRetiredReceiptDigest",
      pi.anchorRetiredReceiptDigest,
      pv.anchorReceiptDigest,
    ],
    ["priorInstallation.projectId", pi.projectId, expected.value.priorProjectId],
    ["priorInstallation.stateRootDigest", pi.stateRootDigest, expected.value.priorStateRootDigest],
    ["archive.destinationDigest", a.destinationDigest, c.destinationDigest],
    ["archive.priorOwnerTipDigest", a.priorOwnerTipDigest, pp.priorTipDigest],
    ["archive.priorOwnerValueDigest", a.priorOwnerValueDigest, pp.priorValueDigest],
    ["archive.priorOwnerReceiptDigest", a.priorOwnerReceiptDigest, pp.priorReceiptDigest],
    ["archive.installationId", a.installationId, pi.installationId],
    ["archive.anchorRetiredTipDigest", a.anchorRetiredTipDigest, pi.anchorRetiredTipDigest],
    ["archive.anchorRetiredValueDigest", a.anchorRetiredValueDigest, pi.anchorRetiredValueDigest],
    [
      "archive.anchorRetiredReceiptDigest",
      a.anchorRetiredReceiptDigest,
      pi.anchorRetiredReceiptDigest,
    ],
    ["archive.observationDigest", a.observationDigest, expected.value.teardownAbsenceDigest],
    [
      "review.authorIdentityDigest",
      review.authorIdentityDigest,
      expected.value.authorIdentityDigest,
    ],
    [
      "review.reviewerIdentityDigest",
      review.reviewerIdentityDigest,
      expected.value.reviewerIdentityDigest,
    ],
    ["review.reviewReceiptDigest", review.reviewReceiptDigest, expected.value.reviewReceiptDigest],
  ] as const)
    if (actual !== selected) issues.push(`${field}:mismatch`);
  if (pv.lifecycle !== "RETIRED") issues.push("priorValue:lifecycle-not-retired");
  if (pv.teardownArchiveDigest !== archiveDigest)
    issues.push("priorValue:teardownArchiveDigest:mismatch");
  if (pp.transition !== "RETIRE_UNUSED" && pp.transition !== "RETIRE_CONSUMED")
    issues.push("priorProposal:transition-not-retirement");
  if (pp.source !== "ANCHOR_RETIRED") issues.push("priorProposal:source-not-anchor-retired");
  if (pp.transitionEvidenceDigest !== archiveDigest)
    issues.push("priorProposal:transitionEvidenceDigest:mismatch");
  if (pi.installationId === sa.installationId)
    issues.push("successorAuthority:installation-not-distinct");
  if (!sameCanonical(sa, expected.value.successorAuthority))
    issues.push("successorAuthority:expected-mismatch");
  if (review.candidateDigest !== computeDestinationOwnerSuccessorReviewCandidateDigest(c))
    issues.push("independentReview:candidateDigest:mismatch");
  return Object.freeze([...new Set(issues)].sort());
}

export function validateDestinationOwnerSuccessorPostSelectionBinding(
  receiptInput: unknown,
  coreInput: unknown,
  successorValueInput: unknown,
  successorProposalInput: unknown,
  successorTipInput: unknown,
  priorTipInput: unknown,
  priorValueInput: unknown,
  priorProposalInput: unknown,
  expectedInput: unknown,
): readonly string[] {
  const receipt = parseDestinationOwnerSuccessorPostSelection(receiptInput);
  const core = parseDestinationOwnerSuccessorReviewCore(coreInput);
  const successorValue = parseDestinationOwnerValue(successorValueInput);
  const successorProposal = parseDestinationOwnerProposal(successorProposalInput);
  const successorTip = parseDestinationOwnerTip(successorTipInput);
  const expected = snapshotClosedRecord(expectedInput, postExpectationFields);
  const issues = [
    ...prefixed("receipt", receipt),
    ...prefixed("core", core),
    ...prefixed("successorValue", successorValue),
    ...prefixed("successorProposal", successorProposal),
    ...prefixed("successorTip", successorTip),
    ...(expected.ok ? [] : expected.issues.map((issue) => `expected:${issue}`)),
  ];
  if (
    !receipt.ok ||
    !core.ok ||
    !successorValue.ok ||
    !successorProposal.ok ||
    !successorTip.ok ||
    !expected.ok
  )
    return Object.freeze([...new Set(issues)].sort());
  for (const field of postExpectationFields)
    if (!isSha256(expected.value[field])) issues.push(`expected:${field}:invalid`);
  const r = receipt.value;
  const c = core.value;
  const value = successorValue.value;
  const proposal = successorProposal.value;
  const tip = successorTip.value;
  const authority = c.successorAuthority as ContractRecord;
  const coreDigest = computeDestinationOwnerSuccessorReviewCoreDigest(c);
  const valueDigest = computeDestinationOwnerValueDigest(value);
  const proposalDigest = computeDestinationOwnerProposalDigest(proposal);
  const tipDigest = computeDestinationOwnerTipDigest(tip);
  issues.push(
    ...validateDestinationOwnerMutationBinding(
      proposal,
      value,
      priorTipInput,
      priorValueInput,
      priorProposalInput,
      {
        anchorDigest: expected.value.successorAnchorDigest,
        destinationDigest: c.destinationDigest,
        installationId: authority.installationId,
        observationDigest: expected.value.observationDigest,
        transitionEvidenceDigest: coreDigest,
      },
    ).map((issue) => `ownerMutation:${issue}`),
  );
  for (const [field, actual, selected] of [
    ["reviewCoreDigest", r.reviewCoreDigest, coreDigest],
    ["successorAnchorDigest", r.successorAnchorDigest, expected.value.successorAnchorDigest],
    ["successorOwnerValueDigest", r.successorOwnerValueDigest, valueDigest],
    ["successorOwnerProposalReceiptDigest", r.successorOwnerProposalReceiptDigest, proposalDigest],
    ["successorOwnerTipDigest", r.successorOwnerTipDigest, tipDigest],
    ["successorValue.anchorDigest", value.anchorDigest, expected.value.successorAnchorDigest],
    ["successorValue.successorReviewCoreDigest", value.successorReviewCoreDigest, coreDigest],
    ["successorValue.installationId", value.installationId, authority.installationId],
    ["successorValue.destinationDigest", value.destinationDigest, c.destinationDigest],
    ["successorTip.valueDigest", tip.valueDigest, valueDigest],
    ["successorTip.proposalReceiptDigest", tip.proposalReceiptDigest, proposalDigest],
    ["valueReadbackDigest", r.valueReadbackDigest, expected.value.valueReadbackDigest],
    ["proposalReadbackDigest", r.proposalReadbackDigest, expected.value.proposalReadbackDigest],
    ["tipReadbackDigest", r.tipReadbackDigest, expected.value.tipReadbackDigest],
    [
      "destinationLockCustodyObservationDigest",
      r.destinationLockCustodyObservationDigest,
      expected.value.destinationLockCustodyObservationDigest,
    ],
  ] as const)
    if (actual !== selected) issues.push(`${field}:mismatch`);
  return Object.freeze([...new Set(issues)].sort());
}

export function parseDestinationOwnerSuccessorContract(
  expectedSchemaVersion: string,
  input: unknown,
): ParseResult | undefined {
  if (expectedSchemaVersion === "destination-owner-prior-installation/v1")
    return parseDestinationOwnerPriorInstallation(input);
  if (expectedSchemaVersion === "destination-owner-successor-authority/v1")
    return parseDestinationOwnerSuccessorAuthority(input);
  if (expectedSchemaVersion === "destination-owner-independent-review/v1")
    return parseDestinationOwnerIndependentReview(input);
  if (expectedSchemaVersion === "state-mutation-destination-owner-successor-review-core/v1")
    return parseDestinationOwnerSuccessorReviewCore(input);
  if (
    expectedSchemaVersion ===
    "state-mutation-destination-owner-successor-review-post-selection-receipt/v1"
  )
    return parseDestinationOwnerSuccessorPostSelection(input);
  return undefined;
}

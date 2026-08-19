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
import { parseStateMutationAuthorityValue } from "./authority.js";
import { externalAuthorityPaths } from "./external.js";
import {
  computeBootstrapGenesisCoreDigest,
  computeBootstrapGenesisPostSelectionDigest,
  parseBootstrapGenesisCore,
  parseBootstrapGenesisPostSelection,
  validateBootstrapGenesisPostSelectionBinding,
} from "./genesis.js";
import { computeBootstrapAnchorUseIntentDigest, parseBootstrapAnchorUseIntent } from "./intent.js";
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
  computePointerValueDigest,
  computeProposalReceiptDigest,
  parsePointerCurrentTip,
  parsePointerProposal,
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

const consumptionReceiptFields = Object.freeze([
  "anchorDigest",
  "bootstrapGenesisCoreDigest",
  "bootstrapTransactionId",
  "consumedAt",
  "custodyInstanceDigest",
  "destinationOwnerActiveReceiptDigest",
  "destinationOwnerActiveTipDigest",
  "destinationOwnerActiveValueDigest",
  "destinationOwnerConsumedReceiptDigest",
  "destinationOwnerConsumedTipDigest",
  "destinationOwnerConsumedValueDigest",
  "destinationStateRootDigest",
  "externalAnchorProposalReadbackDigest",
  "externalAnchorTipReadbackDigest",
  "externalAnchorValueReadbackDigest",
  "externalRuntimeCustodyDigest",
  "runtimePostSelectionReceiptDigest",
  "runtimePostSelectionReceiptReadbackDigest",
  "runtimeProposalReadbackDigest",
  "runtimeReceiptDigest",
  "runtimeTipDigest",
  "runtimeTipReadbackDigest",
  "runtimeValueDigest",
  "runtimeValueReadbackDigest",
  "schemaVersion",
  "selectedAuthorityPathInstanceDigest",
  "useIntentDigest",
] as const);

export const bootstrapConsumptionSchemaFields = Object.freeze({
  receipt: consumptionReceiptFields,
});
export const bootstrapConsumptionSchemaVersions = Object.freeze([
  "state-mutation-bootstrap-anchor-consumption-receipt/v1",
] as const);

function invalid(...issues: readonly string[]): ParseResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function prefixed(prefix: string, parsed: ParseResult): string[] {
  return parsed.ok ? [] : parsed.issues.map((issue) => `${prefix}:${issue}`);
}

function parsedOrThrow(parser: (input: unknown) => ParseResult, input: unknown): ContractRecord {
  const parsed = parser(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return parsed.value;
}

export function parseBootstrapAnchorConsumptionReceipt(input: unknown): ParseResult {
  const parsed = snapshotClosedRecord(input, consumptionReceiptFields);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const issues = consumptionReceiptFields
    .filter((field) => field.endsWith("Digest"))
    .filter((field) => !isSha256(record[field]))
    .map((field) => `${field}:invalid`);
  if (!isUuidV7(record.bootstrapTransactionId)) issues.push("bootstrapTransactionId:invalid");
  if (!isCanonicalTimestamp(record.consumedAt)) issues.push("consumedAt:invalid");
  if (record.schemaVersion !== "state-mutation-bootstrap-anchor-consumption-receipt/v1")
    issues.push("schemaVersion:mismatch");
  return issues.length === 0 ? parsed : invalid(...issues);
}

export function computeBootstrapAnchorConsumptionReceiptDigest(input: unknown): string {
  const record = parsedOrThrow(parseBootstrapAnchorConsumptionReceipt, input);
  return framedDigest("bootstrap-anchor-consumption-receipt/v1", [
    frame.raw32(String(record.anchorDigest)),
    frame.raw32(String(record.bootstrapGenesisCoreDigest)),
    frame.raw32(String(record.selectedAuthorityPathInstanceDigest)),
    frame.raw32(String(record.runtimeValueDigest)),
    frame.raw32(String(record.runtimeReceiptDigest)),
    frame.raw32(String(record.runtimeTipDigest)),
    frame.raw32(String(record.runtimePostSelectionReceiptDigest)),
    frame.text(String(record.bootstrapTransactionId)),
    frame.raw32(String(record.useIntentDigest)),
    frame.raw32(String(record.destinationStateRootDigest)),
    frame.raw32(String(record.custodyInstanceDigest)),
    frame.raw32(String(record.runtimeValueReadbackDigest)),
    frame.raw32(String(record.runtimeProposalReadbackDigest)),
    frame.raw32(String(record.runtimeTipReadbackDigest)),
    frame.raw32(String(record.runtimePostSelectionReceiptReadbackDigest)),
    frame.raw32(String(record.destinationOwnerActiveTipDigest)),
    frame.raw32(String(record.destinationOwnerActiveValueDigest)),
    frame.raw32(String(record.destinationOwnerActiveReceiptDigest)),
    frame.raw32(String(record.destinationOwnerConsumedTipDigest)),
    frame.raw32(String(record.destinationOwnerConsumedValueDigest)),
    frame.raw32(String(record.destinationOwnerConsumedReceiptDigest)),
    frame.raw32(String(record.externalAnchorValueReadbackDigest)),
    frame.raw32(String(record.externalAnchorProposalReadbackDigest)),
    frame.raw32(String(record.externalAnchorTipReadbackDigest)),
    frame.raw32(String(record.externalRuntimeCustodyDigest)),
    frame.text(String(record.consumedAt)),
    frame.canonical(record),
  ]);
}

export function computeBootstrapAnchorConsumptionId(input: unknown): string {
  const record = parsedOrThrow(parseBootstrapAnchorConsumptionReceipt, input);
  return framedDigest("bootstrap-anchor-consumption-id/v1", [
    frame.raw32(String(record.anchorDigest)),
    frame.text(String(record.bootstrapTransactionId)),
    frame.raw32(String(record.runtimePostSelectionReceiptDigest)),
    frame.raw32(String(record.destinationOwnerConsumedTipDigest)),
  ]);
}

export function bootstrapAnchorConsumptionReceiptPath(
  anchorInput: unknown,
  receiptInput: unknown,
): string {
  const anchor = parsedOrThrow(parseBootstrapAnchor, anchorInput);
  return externalAuthorityPaths.bootstrapAnchorConsumptionReceipt(
    String(anchor.installationId),
    computeBootstrapAnchorConsumptionId(receiptInput),
  );
}

export function validateBootstrapAnchorConsumptionBinding(
  receiptInput: unknown,
  anchorInput: unknown,
  useIntentInput: unknown,
  genesisCoreInput: unknown,
  authorityValueInput: unknown,
  runtimeProposalInput: unknown,
  runtimeTipInput: unknown,
  runtimePostInput: unknown,
  anchorActiveTipInput: unknown,
  anchorActiveValueInput: unknown,
  anchorActiveProposalInput: unknown,
  anchorConsumedTipInput: unknown,
  anchorConsumedValueInput: unknown,
  anchorConsumedProposalInput: unknown,
  ownerActiveTipInput: unknown,
  ownerActiveValueInput: unknown,
  ownerActiveProposalInput: unknown,
  ownerConsumedTipInput: unknown,
  ownerConsumedValueInput: unknown,
  ownerConsumedProposalInput: unknown,
): readonly string[] {
  const receipt = parseBootstrapAnchorConsumptionReceipt(receiptInput);
  const anchor = parseBootstrapAnchor(anchorInput);
  const intent = parseBootstrapAnchorUseIntent(useIntentInput);
  const core = parseBootstrapGenesisCore(genesisCoreInput);
  const authority = parseStateMutationAuthorityValue(authorityValueInput);
  const runtimeProposal = parsePointerProposal(runtimeProposalInput);
  const runtimeTip = parsePointerCurrentTip(runtimeTipInput);
  const runtimePost = parseBootstrapGenesisPostSelection(runtimePostInput);
  const anchorActiveTip = parseBootstrapAnchorTip(anchorActiveTipInput);
  const anchorActiveValue = parseBootstrapAnchorLifecycleValue(anchorActiveValueInput);
  const anchorActiveProposal = parseBootstrapAnchorProposal(anchorActiveProposalInput);
  const anchorConsumedTip = parseBootstrapAnchorTip(anchorConsumedTipInput);
  const anchorConsumedValue = parseBootstrapAnchorLifecycleValue(anchorConsumedValueInput);
  const anchorConsumedProposal = parseBootstrapAnchorProposal(anchorConsumedProposalInput);
  const ownerActiveTip = parseDestinationOwnerTip(ownerActiveTipInput);
  const ownerActiveValue = parseDestinationOwnerValue(ownerActiveValueInput);
  const ownerActiveProposal = parseDestinationOwnerProposal(ownerActiveProposalInput);
  const ownerConsumedTip = parseDestinationOwnerTip(ownerConsumedTipInput);
  const ownerConsumedValue = parseDestinationOwnerValue(ownerConsumedValueInput);
  const ownerConsumedProposal = parseDestinationOwnerProposal(ownerConsumedProposalInput);
  const parsed = [
    ["receipt", receipt],
    ["anchor", anchor],
    ["intent", intent],
    ["core", core],
    ["authority", authority],
    ["runtimeProposal", runtimeProposal],
    ["runtimeTip", runtimeTip],
    ["runtimePost", runtimePost],
    ["anchorActiveTip", anchorActiveTip],
    ["anchorActiveValue", anchorActiveValue],
    ["anchorActiveProposal", anchorActiveProposal],
    ["anchorConsumedTip", anchorConsumedTip],
    ["anchorConsumedValue", anchorConsumedValue],
    ["anchorConsumedProposal", anchorConsumedProposal],
    ["ownerActiveTip", ownerActiveTip],
    ["ownerActiveValue", ownerActiveValue],
    ["ownerActiveProposal", ownerActiveProposal],
    ["ownerConsumedTip", ownerConsumedTip],
    ["ownerConsumedValue", ownerConsumedValue],
    ["ownerConsumedProposal", ownerConsumedProposal],
  ] as const;
  const issues = parsed.flatMap(([name, result]) => prefixed(name, result));
  if (
    !receipt.ok ||
    !anchor.ok ||
    !intent.ok ||
    !core.ok ||
    !authority.ok ||
    !runtimeProposal.ok ||
    !runtimeTip.ok ||
    !runtimePost.ok ||
    !anchorActiveTip.ok ||
    !anchorActiveValue.ok ||
    !anchorActiveProposal.ok ||
    !anchorConsumedTip.ok ||
    !anchorConsumedValue.ok ||
    !anchorConsumedProposal.ok ||
    !ownerActiveTip.ok ||
    !ownerActiveValue.ok ||
    !ownerActiveProposal.ok ||
    !ownerConsumedTip.ok ||
    !ownerConsumedValue.ok ||
    !ownerConsumedProposal.ok
  )
    return Object.freeze([...new Set(issues)].sort());

  const r = receipt.value;
  const a = anchor.value;
  const i = intent.value;
  const c = core.value;
  const av = authority.value;
  const rp = runtimeProposal.value;
  const rt = runtimeTip.value;
  const post = runtimePost.value;
  const aat = anchorActiveTip.value;
  const aav = anchorActiveValue.value;
  const aap = anchorActiveProposal.value;
  const act = anchorConsumedTip.value;
  const acv = anchorConsumedValue.value;
  const acp = anchorConsumedProposal.value;
  const oat = ownerActiveTip.value;
  const oav = ownerActiveValue.value;
  const oap = ownerActiveProposal.value;
  const oct = ownerConsumedTip.value;
  const ocv = ownerConsumedValue.value;
  const ocp = ownerConsumedProposal.value;

  let anchorDigest: string;
  try {
    anchorDigest = computeBootstrapAnchorDigest(a);
  } catch {
    return Object.freeze(["anchor:globalBootstrapIdentityDigest:mismatch"]);
  }
  const coreDigest = computeBootstrapGenesisCoreDigest(c);
  const authorityDp = String(c.authorityPathInstanceDigest);
  const authorityDv = computePointerValueDigest(
    "STATE_MUTATION_AUTHORITY_ROTATION",
    authorityDp,
    av,
  );
  const authorityDr = computeProposalReceiptDigest(rp);
  const authorityDt = computeCurrentTipDigest(rt);
  const postDigest = computeBootstrapGenesisPostSelectionDigest(post);
  const useIntentDigest = computeBootstrapAnchorUseIntentDigest(i);
  const anchorActiveTipDigest = computeBootstrapAnchorTipDigest(aat);
  const anchorActiveValueDigest = computeBootstrapAnchorValueDigest(aav);
  const anchorActiveReceiptDigest = computeBootstrapAnchorProposalDigest(aap);
  const anchorConsumedTipDigest = computeBootstrapAnchorTipDigest(act);
  const anchorConsumedValueDigest = computeBootstrapAnchorValueDigest(acv);
  const anchorConsumedReceiptDigest = computeBootstrapAnchorProposalDigest(acp);
  const ownerActiveTipDigest = computeDestinationOwnerTipDigest(oat);
  const ownerActiveValueDigest = computeDestinationOwnerValueDigest(oav);
  const ownerActiveReceiptDigest = computeDestinationOwnerProposalDigest(oap);
  const ownerConsumedTipDigest = computeDestinationOwnerTipDigest(oct);
  const ownerConsumedValueDigest = computeDestinationOwnerValueDigest(ocv);
  const ownerConsumedReceiptDigest = computeDestinationOwnerProposalDigest(ocp);

  issues.push(
    ...validateBootstrapGenesisPostSelectionBinding(post, c, a, av, rp, rt, {
      anchorDigest,
      authorityPathInstanceDigest: authorityDp,
      bootstrapGenesisCoreDigest: coreDigest,
    }).map((issue) => `runtimePostBinding:${issue}`),
    ...validateBootstrapAnchorMutationBinding(a, acp, acv, aat, aav, aap, {
      anchorDigest,
      transitionEvidenceDigest: postDigest,
    }).map((issue) => `anchorConsumedBinding:${issue}`),
    ...validateDestinationOwnerMutationBinding(ocp, ocv, oat, oav, oap, {
      anchorDigest,
      destinationDigest: a.destinationDigest,
      installationId: a.installationId,
      observationDigest: av.admittedCustodyObservationDigest,
      transitionEvidenceDigest: anchorConsumedTipDigest,
    }).map((issue) => `ownerConsumedBinding:${issue}`),
  );

  for (const [field, actual, selected] of [
    ["anchorDigest", r.anchorDigest, anchorDigest],
    ["bootstrapGenesisCoreDigest", r.bootstrapGenesisCoreDigest, coreDigest],
    ["bootstrapTransactionId", r.bootstrapTransactionId, a.bootstrapTransactionId],
    ["custodyInstanceDigest", r.custodyInstanceDigest, a.custodyInstanceDigest],
    ["destinationStateRootDigest", r.destinationStateRootDigest, a.stateRootDigest],
    ["useIntentDigest", r.useIntentDigest, useIntentDigest],
    ["intent.bootstrapTransactionId", i.bootstrapTransactionId, a.bootstrapTransactionId],
    ["intent.destinationDigest", i.destinationDigest, a.destinationDigest],
    ["intent.destinationStateRootDigest", i.destinationStateRootDigest, a.stateRootDigest],
    ["intent.custodyInstanceDigest", i.custodyInstanceDigest, a.custodyInstanceDigest],
    ["core.anchorDigest", c.anchorDigest, anchorDigest],
    ["core.bootstrapTransactionId", c.bootstrapTransactionId, a.bootstrapTransactionId],
    ["core.destinationDigest", c.destinationDigest, a.destinationDigest],
    ["authority.installationId", av.installationId, a.installationId],
    ["authority.projectId", av.projectId, a.projectId],
    ["authority.stateRootDigest", av.stateRootDigest, a.stateRootDigest],
    ["authority.custodyInstanceDigest", av.custodyInstanceDigest, a.custodyInstanceDigest],
    ["selectedAuthorityPathInstanceDigest", r.selectedAuthorityPathInstanceDigest, authorityDp],
    ["runtimeValueDigest", r.runtimeValueDigest, authorityDv],
    ["runtimeReceiptDigest", r.runtimeReceiptDigest, authorityDr],
    ["runtimeTipDigest", r.runtimeTipDigest, authorityDt],
    ["runtimePostSelectionReceiptDigest", r.runtimePostSelectionReceiptDigest, postDigest],
    ["runtimeValueReadbackDigest", r.runtimeValueReadbackDigest, canonicalDigest(av)],
    ["runtimeProposalReadbackDigest", r.runtimeProposalReadbackDigest, canonicalDigest(rp)],
    ["runtimeTipReadbackDigest", r.runtimeTipReadbackDigest, canonicalDigest(rt)],
    [
      "runtimePostSelectionReceiptReadbackDigest",
      r.runtimePostSelectionReceiptReadbackDigest,
      canonicalDigest(post),
    ],
    ["destinationOwnerActiveTipDigest", r.destinationOwnerActiveTipDigest, ownerActiveTipDigest],
    [
      "destinationOwnerActiveValueDigest",
      r.destinationOwnerActiveValueDigest,
      ownerActiveValueDigest,
    ],
    [
      "destinationOwnerActiveReceiptDigest",
      r.destinationOwnerActiveReceiptDigest,
      ownerActiveReceiptDigest,
    ],
    [
      "destinationOwnerConsumedTipDigest",
      r.destinationOwnerConsumedTipDigest,
      ownerConsumedTipDigest,
    ],
    [
      "destinationOwnerConsumedValueDigest",
      r.destinationOwnerConsumedValueDigest,
      ownerConsumedValueDigest,
    ],
    [
      "destinationOwnerConsumedReceiptDigest",
      r.destinationOwnerConsumedReceiptDigest,
      ownerConsumedReceiptDigest,
    ],
    [
      "externalAnchorValueReadbackDigest",
      r.externalAnchorValueReadbackDigest,
      canonicalDigest(acv),
    ],
    [
      "externalAnchorProposalReadbackDigest",
      r.externalAnchorProposalReadbackDigest,
      canonicalDigest(acp),
    ],
    ["externalAnchorTipReadbackDigest", r.externalAnchorTipReadbackDigest, canonicalDigest(act)],
    [
      "externalRuntimeCustodyDigest",
      r.externalRuntimeCustodyDigest,
      av.admittedCustodyObservationDigest,
    ],
    ["intent.anchorActiveTipDigest", i.anchorActiveTipDigest, anchorActiveTipDigest],
    ["intent.anchorActiveValueDigest", i.anchorActiveValueDigest, anchorActiveValueDigest],
    ["intent.anchorActiveReceiptDigest", i.anchorActiveReceiptDigest, anchorActiveReceiptDigest],
    [
      "core.destinationOwnerActiveTipDigest",
      c.destinationOwnerActiveTipDigest,
      ownerActiveTipDigest,
    ],
    [
      "core.destinationOwnerActiveValueDigest",
      c.destinationOwnerActiveValueDigest,
      ownerActiveValueDigest,
    ],
    [
      "core.destinationOwnerActiveReceiptDigest",
      c.destinationOwnerActiveReceiptDigest,
      ownerActiveReceiptDigest,
    ],
    ["anchorConsumedTip.valueDigest", act.valueDigest, anchorConsumedValueDigest],
    [
      "anchorConsumedTip.proposalReceiptDigest",
      act.proposalReceiptDigest,
      anchorConsumedReceiptDigest,
    ],
    ["anchorConsumedValue.bootstrapGenesisCoreDigest", acv.bootstrapGenesisCoreDigest, coreDigest],
    [
      "anchorConsumedValue.selectedAuthorityPathInstanceDigest",
      acv.selectedAuthorityPathInstanceDigest,
      authorityDp,
    ],
    [
      "anchorConsumedValue.selectedAuthorityValueDigest",
      acv.selectedAuthorityValueDigest,
      authorityDv,
    ],
    [
      "anchorConsumedValue.selectedAuthorityReceiptDigest",
      acv.selectedAuthorityReceiptDigest,
      authorityDr,
    ],
    ["anchorConsumedValue.selectedAuthorityTipDigest", acv.selectedAuthorityTipDigest, authorityDt],
    ["anchorConsumedValue.selectionPostReceiptDigest", acv.selectionPostReceiptDigest, postDigest],
    ["ownerConsumedValue.anchorTipDigest", ocv.anchorTipDigest, anchorConsumedTipDigest],
    ["ownerConsumedValue.anchorValueDigest", ocv.anchorValueDigest, anchorConsumedValueDigest],
    [
      "ownerConsumedValue.anchorReceiptDigest",
      ocv.anchorReceiptDigest,
      anchorConsumedReceiptDigest,
    ],
    ["ownerConsumedTip.valueDigest", oct.valueDigest, ownerConsumedValueDigest],
    [
      "ownerConsumedTip.proposalReceiptDigest",
      oct.proposalReceiptDigest,
      ownerConsumedReceiptDigest,
    ],
    [
      "ownerActiveProposal.observationDigest",
      oap.observationDigest,
      av.admittedCustodyObservationDigest,
    ],
    [
      "ownerConsumedProposal.observationDigest",
      ocp.observationDigest,
      av.admittedCustodyObservationDigest,
    ],
  ] as const)
    if (actual !== selected) issues.push(`${field}:mismatch`);

  if (aav.lifecycle !== "ACTIVE") issues.push("anchorActiveValue:lifecycle-not-active");
  if (acv.lifecycle !== "CONSUMED") issues.push("anchorConsumedValue:lifecycle-not-consumed");
  if (oav.lifecycle !== "ACTIVE") issues.push("ownerActiveValue:lifecycle-not-active");
  if (ocv.lifecycle !== "CONSUMED") issues.push("ownerConsumedValue:lifecycle-not-consumed");
  if (String(r.consumedAt) < String(post.observedAt)) issues.push("consumedAt:before-runtime-post");
  if (String(r.consumedAt) < String(acp.proposedAt))
    issues.push("consumedAt:before-anchor-consumed");
  if (String(r.consumedAt) < String(ocp.proposedAt))
    issues.push("consumedAt:before-owner-consumed");
  return Object.freeze([...new Set(issues)].sort());
}

export function parseBootstrapConsumptionContract(
  expectedSchemaVersion: string,
  input: unknown,
): ParseResult | undefined {
  return expectedSchemaVersion === "state-mutation-bootstrap-anchor-consumption-receipt/v1"
    ? parseBootstrapAnchorConsumptionReceipt(input)
    : undefined;
}

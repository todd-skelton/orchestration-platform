import {
  computeBootstrapAnchorDigest,
  computeBootstrapAnchorProposalDigest,
  computeBootstrapAnchorTipDigest,
  computeBootstrapAnchorValueDigest,
  parseBootstrapAnchor,
  parseBootstrapAnchorLifecycleValue,
  parseBootstrapAnchorProposal,
  parseBootstrapAnchorTip,
} from "./anchor.js";
import {
  computeAuthorityHistoryRecordDigest,
  computeGenesisBootstrapInputDigest,
  parseAuthorityHistoryRecord,
  parseGenesisBootstrapInput,
  parseGenesisSelectionEvidence,
  parseStateMutationAuthorityValue,
} from "./authority.js";
import {
  computeBootstrapAnchorConsumptionReceiptDigest,
  parseBootstrapAnchorConsumptionReceipt,
  validateBootstrapAnchorConsumptionBinding,
} from "./consumption.js";
import {
  computeBootstrapGenesisCoreDigest,
  computeBootstrapGenesisPostSelectionDigest,
  parseBootstrapGenesisCore,
  parseBootstrapGenesisPostSelection,
} from "./genesis.js";
import { computeBootstrapAnchorUseIntentDigest, parseBootstrapAnchorUseIntent } from "./intent.js";
import {
  computeDestinationOwnerProposalDigest,
  computeDestinationOwnerTipDigest,
  computeDestinationOwnerValueDigest,
  parseDestinationOwnerProposal,
  parseDestinationOwnerTip,
  parseDestinationOwnerValue,
} from "./owner.js";
import {
  computeCurrentTipDigest,
  computePointerValueDigest,
  computeProposalReceiptDigest,
  parsePointerCurrentTip,
  parsePointerProposal,
} from "./pointer.js";
import { canonicalDigest, type ParseResult } from "./runtime.js";

function prefixed(prefix: string, parsed: ParseResult): string[] {
  return parsed.ok ? [] : parsed.issues.map((issue) => `${prefix}:${issue}`);
}

export function validateGenesisSelectionEvidenceBinding(
  evidenceInput: unknown,
  genesisBootstrapInput: unknown,
  historyRecordInput: unknown,
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
  consumptionReceiptInput: unknown,
): readonly string[] {
  const evidence = parseGenesisSelectionEvidence(evidenceInput);
  const genesisInput = parseGenesisBootstrapInput(genesisBootstrapInput);
  const history = parseAuthorityHistoryRecord(historyRecordInput);
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
  const consumptionReceipt = parseBootstrapAnchorConsumptionReceipt(consumptionReceiptInput);
  const parsed = [
    ["evidence", evidence],
    ["genesisInput", genesisInput],
    ["history", history],
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
    ["consumptionReceipt", consumptionReceipt],
  ] as const;
  const issues = parsed.flatMap(([name, result]) => prefixed(name, result));
  if (
    !evidence.ok ||
    !genesisInput.ok ||
    !history.ok ||
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
    !ownerConsumedProposal.ok ||
    !consumptionReceipt.ok
  )
    return Object.freeze([...new Set(issues)].sort());

  const e = evidence.value;
  const gb = genesisInput.value;
  const h = history.value;
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
  const cr = consumptionReceipt.value;

  let anchorDigest: string;
  try {
    anchorDigest = computeBootstrapAnchorDigest(a);
  } catch {
    return Object.freeze(["anchor:globalBootstrapIdentityDigest:mismatch"]);
  }
  const genesisInputDigest = computeGenesisBootstrapInputDigest(gb);
  const historyDigest = computeAuthorityHistoryRecordDigest(h);
  const coreDigest = computeBootstrapGenesisCoreDigest(c);
  const useIntentDigest = computeBootstrapAnchorUseIntentDigest(i);
  const authorityDp = String(c.authorityPathInstanceDigest);
  const authorityDv = computePointerValueDigest(
    "STATE_MUTATION_AUTHORITY_ROTATION",
    authorityDp,
    av,
  );
  const authorityDr = computeProposalReceiptDigest(rp);
  const authorityDt = computeCurrentTipDigest(rt);
  const postDigest = computeBootstrapGenesisPostSelectionDigest(post);
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
  const consumptionReceiptDigest = computeBootstrapAnchorConsumptionReceiptDigest(cr);

  issues.push(
    ...validateBootstrapAnchorConsumptionBinding(
      cr,
      a,
      i,
      c,
      gb,
      av,
      rp,
      rt,
      post,
      aat,
      aav,
      aap,
      act,
      acv,
      acp,
      oat,
      oav,
      oap,
      oct,
      ocv,
      ocp,
    ).map((issue) => `consumptionBinding:${issue}`),
  );

  const comparisons: readonly (readonly [string, unknown, unknown])[] = [
    ["genesisBootstrapInputDigest", e.genesisBootstrapInputDigest, genesisInputDigest],
    ["historyRecordDigest", e.historyRecordDigest, historyDigest],
    ["successorCoreDigest", e.successorCoreDigest, gb.successorCoreDigest],
    ["bootstrapGenesisCoreDigest", e.bootstrapGenesisCoreDigest, coreDigest],
    ["destinationDigest", e.destinationDigest, gb.destinationDigest],
    ["destinationOwnerActiveTipDigest", e.destinationOwnerActiveTipDigest, ownerActiveTipDigest],
    [
      "destinationOwnerActiveValueDigest",
      e.destinationOwnerActiveValueDigest,
      ownerActiveValueDigest,
    ],
    [
      "destinationOwnerActiveReceiptDigest",
      e.destinationOwnerActiveReceiptDigest,
      ownerActiveReceiptDigest,
    ],
    ["bootstrapAnchorDigest", e.bootstrapAnchorDigest, anchorDigest],
    ["bootstrapAnchorActiveTipDigest", e.bootstrapAnchorActiveTipDigest, anchorActiveTipDigest],
    [
      "bootstrapAnchorActiveValueDigest",
      e.bootstrapAnchorActiveValueDigest,
      anchorActiveValueDigest,
    ],
    [
      "bootstrapAnchorActiveReceiptDigest",
      e.bootstrapAnchorActiveReceiptDigest,
      anchorActiveReceiptDigest,
    ],
    ["useIntentDigest", e.useIntentDigest, useIntentDigest],
    [
      "globalBootstrapIdentityDigest",
      e.globalBootstrapIdentityDigest,
      a.globalBootstrapIdentityDigest,
    ],
    ["bootstrapTransactionId", e.bootstrapTransactionId, a.bootstrapTransactionId],
    ["bootstrapGrantDigest", e.bootstrapGrantDigest, a.bootstrapGrantDigest],
    ["selectedAuthorityPathInstanceDigest", e.selectedAuthorityPathInstanceDigest, authorityDp],
    ["selectedAuthorityTipDigest", e.selectedAuthorityTipDigest, authorityDt],
    ["selectedAuthorityValueDigest", e.selectedAuthorityValueDigest, authorityDv],
    ["selectedAuthorityReceiptDigest", e.selectedAuthorityReceiptDigest, authorityDr],
    [
      "selectedAuthorityValueReadbackDigest",
      e.selectedAuthorityValueReadbackDigest,
      canonicalDigest(av),
    ],
    [
      "selectedAuthorityProposalReadbackDigest",
      e.selectedAuthorityProposalReadbackDigest,
      canonicalDigest(rp),
    ],
    [
      "selectedAuthorityTipReadbackDigest",
      e.selectedAuthorityTipReadbackDigest,
      canonicalDigest(rt),
    ],
    ["selectionPostReceiptDigest", e.selectionPostReceiptDigest, postDigest],
    ["anchorConsumedTipDigest", e.anchorConsumedTipDigest, anchorConsumedTipDigest],
    ["anchorConsumedValueDigest", e.anchorConsumedValueDigest, anchorConsumedValueDigest],
    ["anchorConsumedReceiptDigest", e.anchorConsumedReceiptDigest, anchorConsumedReceiptDigest],
    ["ownerConsumedTipDigest", e.ownerConsumedTipDigest, ownerConsumedTipDigest],
    ["ownerConsumedValueDigest", e.ownerConsumedValueDigest, ownerConsumedValueDigest],
    ["ownerConsumedReceiptDigest", e.ownerConsumedReceiptDigest, ownerConsumedReceiptDigest],
    ["anchorConsumptionReceiptDigest", e.anchorConsumptionReceiptDigest, consumptionReceiptDigest],
    [
      "anchorConsumedValueReadbackDigest",
      e.anchorConsumedValueReadbackDigest,
      canonicalDigest(acv),
    ],
    [
      "anchorConsumedProposalReadbackDigest",
      e.anchorConsumedProposalReadbackDigest,
      canonicalDigest(acp),
    ],
    ["anchorConsumedTipReadbackDigest", e.anchorConsumedTipReadbackDigest, canonicalDigest(act)],
    ["ownerConsumedValueReadbackDigest", e.ownerConsumedValueReadbackDigest, canonicalDigest(ocv)],
    [
      "ownerConsumedProposalReadbackDigest",
      e.ownerConsumedProposalReadbackDigest,
      canonicalDigest(ocp),
    ],
    ["ownerConsumedTipReadbackDigest", e.ownerConsumedTipReadbackDigest, canonicalDigest(oct)],
    ["genesisInput.destinationDigest", gb.destinationDigest, a.destinationDigest],
    ["genesisInput.useIntentDigest", gb.useIntentDigest, useIntentDigest],
    ["genesisInput.successorCoreDigest", gb.successorCoreDigest, c.successorCoreDigest],
    ["history.genesisBootstrapInputDigest", h.genesisBootstrapInputDigest, genesisInputDigest],
    ["history.successorCoreDigest", h.successorCoreDigest, gb.successorCoreDigest],
    ["core.genesisHistoryRecordDigest", c.genesisHistoryRecordDigest, historyDigest],
    ["core.authorityValueDigest", c.authorityValueDigest, authorityDv],
    ["authority.headOrdinal", av.headOrdinal, "0"],
    ["authority.headRecordDigest", av.headRecordDigest, historyDigest],
  ];
  for (const [field, actual, expected] of comparisons)
    if (actual !== expected) issues.push(`${field}:mismatch`);
  if (h.recordKind !== "GENESIS") issues.push("history.recordKind:not-genesis");

  return Object.freeze([...new Set(issues)].sort());
}

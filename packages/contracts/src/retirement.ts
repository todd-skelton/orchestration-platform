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
  computeExternalDestinationAbsenceObservationDigest,
  computePhysicalLocatorObservationDigest,
  parseExternalDestinationAbsenceObservation,
  parsePhysicalLocatorObservation,
} from "./external.js";
import {
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
import { type ParseResult } from "./runtime.js";
import {
  computeBootstrapAnchorTeardownReceiptDigest,
  parseBootstrapAnchorTeardownReceipt,
  validateBootstrapAnchorTeardownBinding,
} from "./teardown.js";

function prefixed(prefix: string, parsed: ParseResult): string[] {
  return parsed.ok ? [] : parsed.issues.map((issue) => `${prefix}:${issue}`);
}

export function validateBootstrapRetirementBinding(
  anchorInput: unknown,
  priorAnchorTipInput: unknown,
  priorAnchorValueInput: unknown,
  priorAnchorProposalInput: unknown,
  selectedOwnerTipInput: unknown,
  selectedOwnerValueInput: unknown,
  selectedOwnerProposalInput: unknown,
  physicalIdentityInput: unknown,
  locatorObservationInput: unknown,
  absenceInput: unknown,
  lifecycleArchiveInput: unknown,
  teardownReceiptInput: unknown,
  absenceExpectedInput: unknown,
  teardownExpectedInput: unknown,
  anchorRetiredTipInput: unknown,
  anchorRetiredValueInput: unknown,
  anchorRetiredProposalInput: unknown,
  ownerTeardownArchiveInput: unknown,
  ownerRetiredTipInput: unknown,
  ownerRetiredValueInput: unknown,
  ownerRetiredProposalInput: unknown,
): readonly string[] {
  const anchor = parseBootstrapAnchor(anchorInput);
  const priorAnchorTip = parseBootstrapAnchorTip(priorAnchorTipInput);
  const priorAnchorValue = parseBootstrapAnchorLifecycleValue(priorAnchorValueInput);
  const priorAnchorProposal = parseBootstrapAnchorProposal(priorAnchorProposalInput);
  const selectedOwnerTip = parseDestinationOwnerTip(selectedOwnerTipInput);
  const selectedOwnerValue = parseDestinationOwnerValue(selectedOwnerValueInput);
  const selectedOwnerProposal = parseDestinationOwnerProposal(selectedOwnerProposalInput);
  const observation = parsePhysicalLocatorObservation(locatorObservationInput);
  const absence = parseExternalDestinationAbsenceObservation(absenceInput);
  const teardownReceipt = parseBootstrapAnchorTeardownReceipt(teardownReceiptInput);
  const anchorRetiredTip = parseBootstrapAnchorTip(anchorRetiredTipInput);
  const anchorRetiredValue = parseBootstrapAnchorLifecycleValue(anchorRetiredValueInput);
  const anchorRetiredProposal = parseBootstrapAnchorProposal(anchorRetiredProposalInput);
  const ownerArchive = parseDestinationOwnerTeardownArchive(ownerTeardownArchiveInput);
  const ownerRetiredTip = parseDestinationOwnerTip(ownerRetiredTipInput);
  const ownerRetiredValue = parseDestinationOwnerValue(ownerRetiredValueInput);
  const ownerRetiredProposal = parseDestinationOwnerProposal(ownerRetiredProposalInput);
  const parsed = [
    ["anchor", anchor],
    ["priorAnchorTip", priorAnchorTip],
    ["priorAnchorValue", priorAnchorValue],
    ["priorAnchorProposal", priorAnchorProposal],
    ["selectedOwnerTip", selectedOwnerTip],
    ["selectedOwnerValue", selectedOwnerValue],
    ["selectedOwnerProposal", selectedOwnerProposal],
    ["observation", observation],
    ["absence", absence],
    ["teardownReceipt", teardownReceipt],
    ["anchorRetiredTip", anchorRetiredTip],
    ["anchorRetiredValue", anchorRetiredValue],
    ["anchorRetiredProposal", anchorRetiredProposal],
    ["ownerArchive", ownerArchive],
    ["ownerRetiredTip", ownerRetiredTip],
    ["ownerRetiredValue", ownerRetiredValue],
    ["ownerRetiredProposal", ownerRetiredProposal],
  ] as const;
  const issues = parsed.flatMap(([name, result]) => prefixed(name, result));
  if (
    !anchor.ok ||
    !priorAnchorTip.ok ||
    !priorAnchorValue.ok ||
    !priorAnchorProposal.ok ||
    !selectedOwnerTip.ok ||
    !selectedOwnerValue.ok ||
    !selectedOwnerProposal.ok ||
    !observation.ok ||
    !absence.ok ||
    !teardownReceipt.ok ||
    !anchorRetiredTip.ok ||
    !anchorRetiredValue.ok ||
    !anchorRetiredProposal.ok ||
    !ownerArchive.ok ||
    !ownerRetiredTip.ok ||
    !ownerRetiredValue.ok ||
    !ownerRetiredProposal.ok
  )
    return Object.freeze([...new Set(issues)].sort());

  const a = anchor.value;
  const pat = priorAnchorTip.value;
  const pav = priorAnchorValue.value;
  const pap = priorAnchorProposal.value;
  const sot = selectedOwnerTip.value;
  const sov = selectedOwnerValue.value;
  const sop = selectedOwnerProposal.value;
  const observed = observation.value;
  const missing = absence.value;
  const receipt = teardownReceipt.value;
  const art = anchorRetiredTip.value;
  const arv = anchorRetiredValue.value;
  const arp = anchorRetiredProposal.value;
  const archive = ownerArchive.value;
  const ort = ownerRetiredTip.value;
  const orv = ownerRetiredValue.value;
  const orp = ownerRetiredProposal.value;
  let anchorDigest: string;
  try {
    anchorDigest = computeBootstrapAnchorDigest(a);
  } catch {
    return Object.freeze(["anchor:globalBootstrapIdentityDigest:mismatch"]);
  }
  const selectedOwnerTipDigest = computeDestinationOwnerTipDigest(sot);
  const selectedOwnerValueDigest = computeDestinationOwnerValueDigest(sov);
  const selectedOwnerReceiptDigest = computeDestinationOwnerProposalDigest(sop);
  const teardownReceiptDigest = computeBootstrapAnchorTeardownReceiptDigest(receipt);
  const absenceDigest = computeExternalDestinationAbsenceObservationDigest(missing);
  const observationDigest = computePhysicalLocatorObservationDigest(observed);
  const anchorRetiredTipDigest = computeBootstrapAnchorTipDigest(art);
  const anchorRetiredValueDigest = computeBootstrapAnchorValueDigest(arv);
  const anchorRetiredReceiptDigest = computeBootstrapAnchorProposalDigest(arp);
  const ownerArchiveDigest = computeDestinationOwnerTeardownArchiveDigest(archive);
  const ownerRetiredTipDigest = computeDestinationOwnerTipDigest(ort);
  const ownerRetiredValueDigest = computeDestinationOwnerValueDigest(orv);
  const ownerRetiredReceiptDigest = computeDestinationOwnerProposalDigest(orp);

  issues.push(
    ...validateBootstrapAnchorTeardownBinding(
      a,
      pat,
      pav,
      pap,
      sot,
      sov,
      sop,
      physicalIdentityInput,
      observed,
      missing,
      lifecycleArchiveInput,
      receipt,
      absenceExpectedInput,
      teardownExpectedInput,
    ).map((issue) => `teardownBinding:${issue}`),
    ...validateBootstrapAnchorMutationBinding(a, arp, arv, pat, pav, pap, {
      anchorDigest,
      transitionEvidenceDigest: teardownReceiptDigest,
    }).map((issue) => `anchorRetiredBinding:${issue}`),
    ...validateDestinationOwnerMutationBinding(orp, orv, sot, sov, sop, {
      anchorDigest,
      destinationDigest: a.destinationDigest,
      installationId: a.installationId,
      observationDigest,
      transitionEvidenceDigest: ownerArchiveDigest,
    }).map((issue) => `ownerRetiredBinding:${issue}`),
  );

  const transition = receipt.retirementTransition;
  for (const [field, actual, expected] of [
    ["anchorRetiredTip.anchorDigest", art.anchorDigest, anchorDigest],
    ["anchorRetiredTip.valueDigest", art.valueDigest, anchorRetiredValueDigest],
    [
      "anchorRetiredTip.proposalReceiptDigest",
      art.proposalReceiptDigest,
      anchorRetiredReceiptDigest,
    ],
    ["anchorRetiredProposal.transition", arp.transition, transition],
    ["ownerArchive.destinationDigest", archive.destinationDigest, a.destinationDigest],
    ["ownerArchive.installationId", archive.installationId, a.installationId],
    ["ownerArchive.priorOwnerTipDigest", archive.priorOwnerTipDigest, selectedOwnerTipDigest],
    ["ownerArchive.priorOwnerValueDigest", archive.priorOwnerValueDigest, selectedOwnerValueDigest],
    [
      "ownerArchive.priorOwnerReceiptDigest",
      archive.priorOwnerReceiptDigest,
      selectedOwnerReceiptDigest,
    ],
    ["ownerArchive.anchorRetiredTipDigest", archive.anchorRetiredTipDigest, anchorRetiredTipDigest],
    [
      "ownerArchive.anchorRetiredValueDigest",
      archive.anchorRetiredValueDigest,
      anchorRetiredValueDigest,
    ],
    [
      "ownerArchive.anchorRetiredReceiptDigest",
      archive.anchorRetiredReceiptDigest,
      anchorRetiredReceiptDigest,
    ],
    ["ownerArchive.teardownReceiptDigest", archive.teardownReceiptDigest, teardownReceiptDigest],
    ["ownerArchive.observationDigest", archive.observationDigest, absenceDigest],
    ["ownerRetiredTip.destinationDigest", ort.destinationDigest, a.destinationDigest],
    ["ownerRetiredTip.valueDigest", ort.valueDigest, ownerRetiredValueDigest],
    ["ownerRetiredTip.proposalReceiptDigest", ort.proposalReceiptDigest, ownerRetiredReceiptDigest],
    ["ownerRetiredProposal.transition", orp.transition, transition],
    ["ownerRetiredValue.anchorTipDigest", orv.anchorTipDigest, anchorRetiredTipDigest],
    ["ownerRetiredValue.anchorValueDigest", orv.anchorValueDigest, anchorRetiredValueDigest],
    ["ownerRetiredValue.anchorReceiptDigest", orv.anchorReceiptDigest, anchorRetiredReceiptDigest],
    ["ownerRetiredValue.teardownArchiveDigest", orv.teardownArchiveDigest, ownerArchiveDigest],
  ] as const)
    if (actual !== expected) issues.push(`${field}:mismatch`);

  return Object.freeze([...new Set(issues)].sort());
}

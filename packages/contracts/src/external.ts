import { frame, framedDigest, isSha256, isUuidV7 } from "./runtime.js";

function sha256(value: string, name: string): string {
  if (!isSha256(value)) throw new TypeError(`${name}:invalid`);
  return value;
}

function uuidV7(value: string, name: string): string {
  if (!isUuidV7(value)) throw new TypeError(`${name}:invalid`);
  return value;
}

function priorBucket(priorTipDigest: string | null): string {
  return priorTipDigest === null ? "genesis" : sha256(priorTipDigest, "priorTipDigest");
}

export function computeBootstrapDestinationIdentityDigest(
  physicalDestinationIdentityDigest: string,
): string {
  return framedDigest("bootstrap-destination-identity/v1", [
    frame.raw32(sha256(physicalDestinationIdentityDigest, "physicalDestinationIdentityDigest")),
  ]);
}

export const externalAuthorityPaths = Object.freeze({
  physicalIdentity: (physicalIdentityDigest: string): string =>
    `state-mutation-destination-identities/${sha256(physicalIdentityDigest, "physicalIdentityDigest")}/identity.json`,
  physicalObservation: (physicalIdentityDigest: string, observationDigest: string): string =>
    `state-mutation-destination-identities/${sha256(physicalIdentityDigest, "physicalIdentityDigest")}/observations/${sha256(observationDigest, "observationDigest")}.json`,
  destinationOwnerRoot: (destinationDigest: string): string =>
    `state-mutation-destination-owners/${sha256(destinationDigest, "destinationDigest")}`,
  destinationOwnerCurrent: (destinationDigest: string): string =>
    `state-mutation-destination-owners/${sha256(destinationDigest, "destinationDigest")}/current.json`,
  destinationOwnerLock: (destinationDigest: string): string =>
    `state-mutation-destination-owners/${sha256(destinationDigest, "destinationDigest")}/destination-owner.lock`,
  destinationOwnerValue: (destinationDigest: string, mutationId: string): string =>
    `state-mutation-destination-owners/${sha256(destinationDigest, "destinationDigest")}/values/${sha256(mutationId, "mutationId")}.json`,
  destinationOwnerProposal: (
    destinationDigest: string,
    priorTipDigest: string | null,
    mutationId: string,
  ): string =>
    `state-mutation-destination-owners/${sha256(destinationDigest, "destinationDigest")}/proposals/${priorBucket(priorTipDigest)}/${sha256(mutationId, "mutationId")}.json`,
  destinationOwnerConflict: (
    destinationDigest: string,
    priorTipDigest: string | null,
    mutationId: string,
  ): string =>
    `state-mutation-destination-owners/${sha256(destinationDigest, "destinationDigest")}/conflicts/${priorBucket(priorTipDigest)}/${sha256(mutationId, "mutationId")}.json`,
  destinationOwnerTeardownArchive: (destinationDigest: string, ownerTipDigest: string): string =>
    `state-mutation-destination-owners/${sha256(destinationDigest, "destinationDigest")}/teardown-archives/${sha256(ownerTipDigest, "ownerTipDigest")}.json`,
  destinationSuccessorReviewCore: (
    destinationDigest: string,
    retiredTipDigest: string,
    reviewCoreDigest: string,
  ): string =>
    `state-mutation-destination-owners/${sha256(destinationDigest, "destinationDigest")}/successor-review-cores/${sha256(retiredTipDigest, "retiredTipDigest")}/${sha256(reviewCoreDigest, "reviewCoreDigest")}.json`,
  destinationSuccessorPostSelectionReceipt: (
    destinationDigest: string,
    successorTipDigest: string,
  ): string =>
    `state-mutation-destination-owners/${sha256(destinationDigest, "destinationDigest")}/successor-review-post-selection-receipts/${sha256(successorTipDigest, "successorTipDigest")}.json`,
  bootstrapAnchor: (installationId: string): string =>
    `state-mutation-authority-anchors/${uuidV7(installationId, "installationId")}/anchor.json`,
  bootstrapAnchorCurrent: (installationId: string): string =>
    `state-mutation-authority-anchors/${uuidV7(installationId, "installationId")}/current.json`,
  bootstrapAnchorLock: (installationId: string): string =>
    `state-mutation-authority-anchors/${uuidV7(installationId, "installationId")}/anchor.lock`,
  bootstrapAnchorValue: (installationId: string, mutationId: string): string =>
    `state-mutation-authority-anchors/${uuidV7(installationId, "installationId")}/values/${sha256(mutationId, "mutationId")}.json`,
  bootstrapAnchorProposal: (
    installationId: string,
    priorTipDigest: string | null,
    mutationId: string,
  ): string =>
    `state-mutation-authority-anchors/${uuidV7(installationId, "installationId")}/proposals/${priorBucket(priorTipDigest)}/${sha256(mutationId, "mutationId")}.json`,
  bootstrapAnchorConflict: (
    installationId: string,
    priorTipDigest: string | null,
    mutationId: string,
  ): string =>
    `state-mutation-authority-anchors/${uuidV7(installationId, "installationId")}/conflicts/${priorBucket(priorTipDigest)}/${sha256(mutationId, "mutationId")}.json`,
  bootstrapAnchorUseIntent: (installationId: string, transactionId: string): string =>
    `state-mutation-authority-anchors/${uuidV7(installationId, "installationId")}/use-intents/${uuidV7(transactionId, "transactionId")}.json`,
  bootstrapAnchorConsumptionReceipt: (installationId: string, mutationId: string): string =>
    `state-mutation-authority-anchors/${uuidV7(installationId, "installationId")}/consumption-receipts/${sha256(mutationId, "mutationId")}.json`,
  bootstrapAnchorTeardownReceipt: (installationId: string, mutationId: string): string =>
    `state-mutation-authority-anchors/${uuidV7(installationId, "installationId")}/teardown-receipts/${sha256(mutationId, "mutationId")}.json`,
  bootstrapAnchorLifecycleArchive: (installationId: string, tipDigest: string): string =>
    `state-mutation-authority-anchors/${uuidV7(installationId, "installationId")}/lifecycle-archives/${sha256(tipDigest, "tipDigest")}.json`,
  bootstrapGenesisCore: (transactionId: string): string =>
    `installation/bootstrap/state-mutation-authority-genesis/${uuidV7(transactionId, "transactionId")}/core.json`,
  bootstrapGenesisPostSelectionReceipt: (transactionId: string): string =>
    `installation/bootstrap/state-mutation-authority-genesis/${uuidV7(transactionId, "transactionId")}/post-selection-receipt.json`,
});

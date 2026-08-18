import { describe, expect, test } from "vitest";
import {
  computeBootstrapDestinationIdentityDigest,
  externalAuthorityPaths,
} from "../../packages/contracts/src/index.js";

const d = (value: string) => value.repeat(64);
const installationId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const transactionId = "018f0f4d-7b2d-7a11-9a2b-123456789abc";

describe("external destination identity and constructed authority paths", () => {
  test("derives Ddest from raw Dphys alone", () => {
    expect(computeBootstrapDestinationIdentityDigest(d("a"))).toBe(
      "41692e007f7bdd90eb112755e3653c4ec785bb0446afe19ba60a9ec69d21aa0b",
    );
    expect(computeBootstrapDestinationIdentityDigest(d("b"))).not.toBe(
      computeBootstrapDestinationIdentityDigest(d("a")),
    );
    expect(() => computeBootstrapDestinationIdentityDigest(d("A"))).toThrow();
  });

  test("constructs destination-owner paths without directory interpretation", () => {
    const destinationDigest = d("1");
    const mutationId = d("2");
    expect(externalAuthorityPaths.physicalIdentity(d("a"))).toBe(
      `state-mutation-destination-identities/${d("a")}/identity.json`,
    );
    expect(externalAuthorityPaths.physicalObservation(d("a"), d("b"))).toBe(
      `state-mutation-destination-identities/${d("a")}/observations/${d("b")}.json`,
    );
    expect(externalAuthorityPaths.destinationOwnerLock(destinationDigest)).toBe(
      `state-mutation-destination-owners/${destinationDigest}/destination-owner.lock`,
    );
    expect(externalAuthorityPaths.destinationOwnerCurrent(destinationDigest)).toBe(
      `state-mutation-destination-owners/${destinationDigest}/current.json`,
    );
    expect(
      externalAuthorityPaths.destinationOwnerProposal(destinationDigest, null, mutationId),
    ).toBe(
      `state-mutation-destination-owners/${destinationDigest}/proposals/genesis/${mutationId}.json`,
    );
    expect(
      externalAuthorityPaths.destinationOwnerConflict(destinationDigest, d("3"), mutationId),
    ).toBe(
      `state-mutation-destination-owners/${destinationDigest}/conflicts/${d("3")}/${mutationId}.json`,
    );
    expect(
      externalAuthorityPaths.destinationSuccessorReviewCore(destinationDigest, d("4"), d("5")),
    ).toBe(
      `state-mutation-destination-owners/${destinationDigest}/successor-review-cores/${d("4")}/${d("5")}.json`,
    );
    expect(
      externalAuthorityPaths.destinationSuccessorPostSelectionReceipt(destinationDigest, d("6")),
    ).toBe(
      `state-mutation-destination-owners/${destinationDigest}/successor-review-post-selection-receipts/${d("6")}.json`,
    );
  });

  test("constructs external anchor and E0 paths with UUIDv7 identity", () => {
    expect(externalAuthorityPaths.bootstrapAnchor(installationId)).toBe(
      `state-mutation-authority-anchors/${installationId}/anchor.json`,
    );
    expect(externalAuthorityPaths.bootstrapAnchorUseIntent(installationId, transactionId)).toBe(
      `state-mutation-authority-anchors/${installationId}/use-intents/${transactionId}.json`,
    );
    expect(externalAuthorityPaths.bootstrapAnchorLifecycleArchive(installationId, d("a"))).toBe(
      `state-mutation-authority-anchors/${installationId}/lifecycle-archives/${d("a")}.json`,
    );
    expect(externalAuthorityPaths.bootstrapGenesisCore(transactionId)).toBe(
      `installation/bootstrap/state-mutation-authority-genesis/${transactionId}/core.json`,
    );
    expect(externalAuthorityPaths.bootstrapGenesisPostSelectionReceipt(transactionId)).toBe(
      `installation/bootstrap/state-mutation-authority-genesis/${transactionId}/post-selection-receipt.json`,
    );
    expect(() => externalAuthorityPaths.bootstrapAnchor("not-a-uuid")).toThrow();
  });

  test("does not expose the deleted retention or sparse-history path families", () => {
    expect(Object.keys(externalAuthorityPaths).join("\n")).not.toMatch(
      /retention|historyLeaf|historyNode|historyRoot|updateProof|appendReceipt/i,
    );
    expect(() => externalAuthorityPaths.destinationOwnerValue(d("z"), d("1"))).toThrow();
  });
});

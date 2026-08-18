import { describe, expect, test } from "vitest";
import {
  cleanupLifecyclePairs,
  cleanupLifecycleTransitions,
  destinationOwnerLifecycles,
  destinationOwnerTransitions,
  engineVocabularyValueFindings,
  isCleanupLifecyclePublicationPair,
  reduceCleanupHeadWrite,
  recoveryAttemptReservationLifecycles,
  validateFenceTransition,
  validateDestinationOwnerTransition,
  validateRecoveryAttemptReservationTransition,
} from "../../packages/contracts/src/index.js";

describe("cleanup and fence transitions", () => {
  test("admits exactly ten cells and twelve non-self mutation edges", () => {
    expect(cleanupLifecyclePairs).toHaveLength(10);
    expect(cleanupLifecycleTransitions).toHaveLength(12);
    expect(new Set(cleanupLifecycleTransitions).size).toBe(12);
    expect(
      cleanupLifecycleTransitions.every((edge) => edge.split(">")[0] !== edge.split(">")[1]),
    ).toBe(true);
    const lifecycles = ["PENDING", "ACTIVATING", "ABORTING", "COMPLETE", "UNKNOWN"];
    const publications = ["NOT_PUBLISHED", "PUBLISHING", "PUBLISHED", "CLEARED", "UNKNOWN"];
    expect(
      lifecycles
        .flatMap((lifecycle) =>
          publications.map((publication) =>
            isCleanupLifecyclePublicationPair(lifecycle, publication),
          ),
        )
        .filter(Boolean),
    ).toHaveLength(10);
  });
  test("reduces replay to NO_APPEND and refuses every non-edge", () => {
    for (const pair of cleanupLifecyclePairs) {
      const [lifecycle, publication] = pair.split("/");
      expect(reduceCleanupHeadWrite(lifecycle, publication, lifecycle, publication)).toBe(
        "NO_APPEND",
      );
    }
    expect(reduceCleanupHeadWrite("PENDING", "NOT_PUBLISHED", "PENDING", "PUBLISHING")).toBe(
      "APPEND",
    );
    expect(reduceCleanupHeadWrite("COMPLETE", "CLEARED", "PENDING", "NOT_PUBLISHED")).toBe(
      "REFUSED",
    );
    expect(validateFenceTransition("PREPARED", "POST_ACTIVATION")).toBe(true);
    expect(validateFenceTransition("PREPARED", "PREPARED")).toBe(false);
    expect(validateFenceTransition("POST_ACTIVATION", "PREPARED")).toBe(false);
  });
});

describe("external owner and recovery reservation lifecycles", () => {
  test("admits exactly the five destination-owner edges", () => {
    expect(destinationOwnerLifecycles).toEqual(["ACTIVE", "CONSUMED", "RETIRED"]);
    expect(destinationOwnerTransitions).toHaveLength(5);
    for (const edge of destinationOwnerTransitions)
      expect(validateDestinationOwnerTransition(edge.previous, edge.next, edge.transition)).toBe(
        true,
      );
    expect(validateDestinationOwnerTransition(null, "ACTIVE", "ACTIVATE_SUCCESSOR")).toBe(false);
    expect(validateDestinationOwnerTransition("ACTIVE", "ACTIVE", "ACTIVATE_GENESIS")).toBe(false);
    expect(validateDestinationOwnerTransition("CONSUMED", "ACTIVE", "ACTIVATE_SUCCESSOR")).toBe(
      false,
    );
    expect(
      engineVocabularyValueFindings([
        ...destinationOwnerLifecycles,
        ...destinationOwnerTransitions.map((edge) => edge.transition),
      ]),
    ).toEqual([]);
  });

  test("admits only RESERVED to CONSUMED to TERMINAL to TOMBSTONE", () => {
    expect(recoveryAttemptReservationLifecycles).toEqual([
      "RESERVED",
      "CONSUMED",
      "TERMINAL",
      "TOMBSTONE",
    ]);
    expect(validateRecoveryAttemptReservationTransition("RESERVED", "CONSUMED")).toBe(true);
    expect(validateRecoveryAttemptReservationTransition("CONSUMED", "TERMINAL")).toBe(true);
    expect(validateRecoveryAttemptReservationTransition("TERMINAL", "TOMBSTONE")).toBe(true);
    expect(validateRecoveryAttemptReservationTransition("RESERVED", "TERMINAL")).toBe(false);
    expect(validateRecoveryAttemptReservationTransition("TERMINAL", "RESERVED")).toBe(false);
    expect(validateRecoveryAttemptReservationTransition("TOMBSTONE", "RESERVED")).toBe(false);
    expect(validateRecoveryAttemptReservationTransition("RESERVED", "RESERVED")).toBe(false);
    expect(engineVocabularyValueFindings(recoveryAttemptReservationLifecycles)).toEqual([]);
  });
});

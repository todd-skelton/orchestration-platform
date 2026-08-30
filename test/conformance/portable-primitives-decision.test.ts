import { describe, expect, test } from "vitest";
import * as decision from "../../packages/conformance/src/portable-primitives-decision.js";
import {
  computePortablePrimitiveObservationDigest,
  computePortablePrimitiveVectorDigest,
  portablePrimitiveCaseIds,
  portablePrimitiveVectors,
} from "../../probes/portable-primitives/src/index.js";

const d = (value: string): string => value.repeat(64);
const observedAt = "2026-08-30T12:00:00.000Z";
const operatingSystems = ["LINUX", "MACOS", "WINDOWS"] as const;

const observations = Object.freeze(
  operatingSystems.flatMap((operatingSystem, osIndex) =>
    portablePrimitiveCaseIds.map((caseId, caseIndex) =>
      Object.freeze({
        caseId,
        detailsDigest: d(String((osIndex + caseIndex) % 10)),
        environmentDigest: d(String(osIndex + 1)),
        normalizedResult: "PASS",
        observedAt,
        operatingSystem,
        schemaVersion: "portable-primitives-observation/v1",
        vectorDigest: computePortablePrimitiveVectorDigest(portablePrimitiveVectors[caseIndex]!),
      }),
    ),
  ),
);

const globals = Object.freeze({
  candidateSubjectDigest: d("1"),
  contractVersionsDigest: d("2"),
  harnessBundleDigest: d("3"),
  providerRunDigest: d("4"),
  requiredJobRegistryDigest: d("5"),
  testBundleDigest: d("6"),
});
const stableHarnessSubjectDigest = decision.computePortablePrimitivesStableHarnessSubjectDigest(
  globals.harnessBundleDigest,
  globals.testBundleDigest,
  globals.requiredJobRegistryDigest,
  globals.contractVersionsDigest,
);
const decisionWriterDigest = decision.computePortablePrimitivesDecisionWriterDigest(
  stableHarnessSubjectDigest,
  globals.harnessBundleDigest,
  globals.testBundleDigest,
  globals.contractVersionsDigest,
);
const passCore = Object.freeze({
  aggregateDigest: d("7"),
  ...globals,
  custodyProfileDigest: "d01b36552a70cdb11cd1e8baf9df096c515158ca0dd3019176c2c83b6d7eb33d",
  decision: "PASS",
  decisionWriterDigest,
  diagnosticTerminalDigest: null,
  helperAbiDigests: Object.freeze([d("8"), d("9"), d("a")] as const),
  helperDigests: Object.freeze([d("b"), d("c"), d("d")] as const),
  observationDigests: Object.freeze(observations.map(computePortablePrimitiveObservationDigest)),
  osProfileDigests: Object.freeze([d("e"), d("f"), d("0")] as const),
  profile: decision.portablePrimitivesCapabilityProfile,
  schemaVersion: decision.portablePrimitivesDecisionCoreSchemaVersion,
  stableHarnessSubjectDigest,
});
function nullProfile(): Readonly<Record<string, null>> {
  return Object.freeze(
    Object.fromEntries(
      Object.keys(decision.portablePrimitivesCapabilityProfile).map((key) => [key, null]),
    ),
  );
}

function blockCore(
  selectedObservations: readonly unknown[] = [
    { ...observations[0]!, normalizedResult: "UNSUPPORTED" },
  ],
) {
  const helperAbiDigests: decision.PortablePrimitivesDigestSlots = Object.freeze([
    d("8"),
    null,
    d("a"),
  ]);
  const helperDigests: decision.PortablePrimitivesDigestSlots = Object.freeze([
    d("b"),
    null,
    d("d"),
  ]);
  const osProfileDigests: decision.PortablePrimitivesDigestSlots = Object.freeze([
    null,
    null,
    null,
  ]);
  return Object.freeze({
    ...passCore,
    aggregateDigest: null,
    decision: "BLOCK_REPLAN",
    diagnosticTerminalDigest: d("f"),
    helperAbiDigests,
    helperDigests,
    observationDigests: Object.freeze(
      selectedObservations.map((row) => computePortablePrimitiveObservationDigest(row)),
    ),
    osProfileDigests,
    profile: nullProfile(),
  });
}

describe("portable primitives capability decision contracts", () => {
  test("pins the stable subject, writer, core bytes, and domain-separated identity", () => {
    expect(stableHarnessSubjectDigest).toBe(
      "77568c140cb1e637706ca460c1c3df6d6c67f74f4f9c1c0177681d8060834c2b",
    );
    expect(decisionWriterDigest).toBe(
      "540ac8956c76546b4a0940b8dcb83c270055b19d366f3dfad608aa5f52861c22",
    );
    const serialized = decision.serializePortablePrimitivesCapabilityDecisionCore(passCore);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    expect(new TextDecoder().decode(serialized.bytes)).toMatch(
      /^\{"aggregateDigest":"7{64}","candidateSubjectDigest":"1{64}"/,
    );
    expect(new TextDecoder().decode(serialized.bytes).endsWith("}\n")).toBe(true);
    expect(serialized.digest).toBe(
      "e8d6a568300efa66efadd7fade6a229e0bb0d3430f98e6d9e9ca9418b07cf366",
    );
  });

  test("closes PASS and BLOCK_REPLAN to their exact unions", () => {
    expect(decision.parsePortablePrimitivesCapabilityDecisionCore(passCore).ok).toBe(true);
    expect(decision.joinPortablePrimitivesDecisionCoreObservations(passCore, observations).ok).toBe(
      true,
    );
    const unsupported = Object.freeze({ ...observations[0]!, normalizedResult: "UNSUPPORTED" });
    const blocked = blockCore([unsupported]);
    expect(decision.parsePortablePrimitivesCapabilityDecisionCore(blocked).ok).toBe(true);
    expect(decision.joinPortablePrimitivesDecisionCoreObservations(blocked, [unsupported]).ok).toBe(
      true,
    );

    for (const mutant of [
      { ...passCore, extra: true },
      { ...passCore, aggregateDigest: null },
      { ...passCore, diagnosticTerminalDigest: d("f") },
      { ...passCore, observationDigests: passCore.observationDigests.slice(1) },
      { ...passCore, helperDigests: [null, ...passCore.helperDigests.slice(1)] },
      { ...passCore, helperAbiDigests: passCore.helperAbiDigests.slice(1) },
      { ...passCore, profile: { ...passCore.profile, process: null } },
      { ...passCore, custodyProfileDigest: d("0") },
      { ...passCore, stableHarnessSubjectDigest: d("0") },
      { ...passCore, decisionWriterDigest: d("0") },
      { ...blocked, aggregateDigest: d("7") },
      { ...blocked, diagnosticTerminalDigest: null },
      { ...blocked, osProfileDigests: [d("e"), null, null] },
      { ...blocked, helperAbiDigests: [d("8"), null, null], helperDigests: [null, null, null] },
      {
        ...blocked,
        profile: { ...blocked.profile, cas: "NODE_LOCKED_READ_PROPOSE_REPLACE_READBACK_V1" },
      },
    ])
      expect(decision.parsePortablePrimitivesCapabilityDecisionCore(mutant).ok).toBe(false);
  });

  test("closes stable observation subsets without inventing diagnostic authority", () => {
    const reversed = [observations[1]!, observations[0]!];
    const blocked = blockCore(reversed);
    expect(decision.joinPortablePrimitivesDecisionCoreObservations(blocked, reversed).ok).toBe(
      false,
    );
    const allPassBlock = Object.freeze({
      ...blockCore(observations),
      helperAbiDigests: passCore.helperAbiDigests,
      helperDigests: passCore.helperDigests,
    });
    expect(decision.parsePortablePrimitivesCapabilityDecisionCore(allPassBlock).ok).toBe(true);
    expect(
      decision.joinPortablePrimitivesDecisionCoreObservations(allPassBlock, observations).ok,
    ).toBe(true);
    const presentLinuxWithoutHelper = Object.freeze({
      ...blockCore([observations[0]!]),
      helperAbiDigests: [null, null, null],
      helperDigests: [null, null, null],
    });
    expect(
      decision.parsePortablePrimitivesCapabilityDecisionCore(presentLinuxWithoutHelper).ok,
    ).toBe(true);
    expect(
      decision.joinPortablePrimitivesDecisionCoreObservations(presentLinuxWithoutHelper, [
        observations[0]!,
      ]).ok,
    ).toBe(false);
    expect(
      decision.joinPortablePrimitivesDecisionCoreObservations(passCore, [...observations].reverse())
        .ok,
    ).toBe(false);
  });

  test("binds independent review disposition and final decision without a digest cycle", () => {
    const decisionCoreDigest =
      decision.computePortablePrimitivesCapabilityDecisionCoreDigest(passCore);
    const review = Object.freeze({
      decisionCoreDigest,
      providerReviewDigest: d("a"),
      reviewDisposition: "AUTHORIZE_PASS",
      reviewedAt: observedAt,
      reviewerSubjectDigest: d("b"),
      schemaVersion: decision.portablePrimitivesIndependentReviewSchemaVersion,
    });
    expect(decision.parsePortablePrimitivesIndependentReview(review).ok).toBe(true);
    expect(decision.joinPortablePrimitivesIndependentReviewToCore(review, passCore).ok).toBe(true);
    expect(
      decision.joinPortablePrimitivesIndependentReviewToCore(
        { ...review, reviewDisposition: "RECORD_BLOCK_REPLAN" },
        passCore,
      ).ok,
    ).toBe(false);
    const reviewDigest = decision.computePortablePrimitivesIndependentReviewDigest(review);
    const finalDecision = Object.freeze({
      decisionCoreDigest,
      independentReviewReceiptDigest: reviewDigest,
      schemaVersion: decision.portablePrimitivesDecisionSchemaVersion,
    });
    const serialized = decision.serializePortablePrimitivesCapabilityDecision(finalDecision);
    expect(serialized.ok).toBe(true);
    expect(
      decision.validatePortablePrimitivesCapabilityDecision(finalDecision, passCore, review).ok,
    ).toBe(true);
    expect(
      decision.validatePortablePrimitivesCapabilityDecision(
        { ...finalDecision, independentReviewReceiptDigest: d("0") },
        passCore,
        review,
      ).ok,
    ).toBe(false);
    expect(
      decision.validatePortablePrimitivesCapabilityDecision(finalDecision, passCore, {
        ...review,
        reviewDisposition: "RECORD_BLOCK_REPLAN",
      }).ok,
    ).toBe(false);
    expect(reviewDigest).toBe("6904dc223db354e11bc0e4a701513191a5e2a6be6c6ecca4d777506830652a93");
    expect(serialized.ok && serialized.digest).toBe(
      "fca927bc70253542c7a7c9a88037e90d9786e2d992c11d90bf590867390740cb",
    );
  });
});

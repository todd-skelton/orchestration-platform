import { describe, expect, test } from "vitest";
import {
  commitRunStages,
  commitJournalPaths,
  computeRunAuditDigest,
  computeRunCheckpointCoreDigest,
  computeRunId,
  computeRunPostSelectionObservationDigest,
  computeRunSegmentDigest,
  parseContract,
  parseRunCheckpointCore,
  parseRunCurrentValue,
  parseRunPostSelectionObservation,
  parseRunSegment,
  validateCommitCheckpointSequence,
  validateRunCurrentSelection,
  validateRunSegmentCore,
} from "../../packages/contracts/src/index.js";

const d = (value: string) => value.repeat(64);
const installationId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";
const projectId = "018f0f4d-7b2d-7a11-9a2b-123456789abc";

function checkpoint(
  index: number,
  pointerKind = "ACTIVE_RELEASE",
  phase = index <= 4 ? "CRASH_PREFIX" : index <= 6 ? "CAS_AMBIGUOUS" : "SELECTED",
) {
  return {
    auditDigest: d("2"),
    canonicalPointerPath:
      pointerKind === "STATE_MUTATION_AUTHORITY_ROTATION"
        ? "installation/state-mutation-authority.json"
        : "installation/active-release.json",
    checkpointOrdinal: String(index),
    globalIdentityDigest: d("3"),
    installationId,
    phase,
    pointerKind,
    priorPostSelectionObservationDigest: index === 0 ? null : d("4"),
    priorSelectorReceiptDigest: index === 0 ? null : d("5"),
    priorSelectorTipDigest: index === 0 ? null : d("6"),
    priorSelectorValueDigest: index === 0 ? null : d("7"),
    projectId,
    runOrdinal: "0",
    schemaVersion: "pointer-mutation-run-checkpoint-core/v1",
    segmentDigest: d("8"),
    sourceToken: "none",
    stage: commitRunStages[index],
    stateRootDigest: d("9"),
    targetMutationId: d("a"),
    targetPathInstanceDigest: d("b"),
    terminalResolutionDigest:
      phase === "SELECTED" || phase === "LOST_CONFLICT" || phase === "UNKNOWN_TERMINAL"
        ? d("c")
        : null,
    transactionId: pointerKind === "STATE_MUTATION_AUTHORITY_ROTATION" ? null : installationId,
  };
}

describe("single-epoch commit journal atoms", () => {
  test("constructs only digest- and ordinal-derived journal paths", () => {
    expect(commitJournalPaths.intent(d("1"), d("2"))).toBe(
      `installation/pointer-cas/${d("1")}/commits/${d("2")}/intent.json`,
    );
    expect(commitJournalPaths.checkpoint(d("1"), d("2"), d("3"))).toBe(
      `installation/pointer-cas/${d("1")}/commits/${d("2")}/checkpoints/${d("3")}.json`,
    );
    expect(commitJournalPaths.runSegment(d("1"), d("2"), "9007199254740991", d("4"))).toBe(
      `installation/pointer-cas/${d("1")}/commits/${d("2")}/runs/9007199254740991-${d("4")}/segment.json`,
    );
    expect(commitJournalPaths.selectorObservation(d("1"), d("2"), d("5"))).toBe(
      `installation/pointer-cas/${d("1")}/commits/${d("2")}/selector-observations/${d("5")}.json`,
    );
    expect(commitJournalPaths.resolution(d("1"), d("2"))).toBe(
      `installation/pointer-cas/${d("1")}/commits/${d("2")}/resolution.json`,
    );
    expect(() =>
      commitJournalPaths.runSegment(d("1"), d("2"), "9007199254740992", d("4")),
    ).toThrow();
    expect(() => commitJournalPaths.intent(d("z"), d("2"))).toThrow();
  });

  test("chains immutable segments into the checkpoint core audit", () => {
    const runId = computeRunId({
      authorityPathInstanceDigest: d("1"),
      authorityReceiptDigest: d("2"),
      authorityTipDigest: d("3"),
      authorityValueDigest: d("4"),
      globalIdentityDigest: d("3"),
      priorCheckpointDigest: null,
      runOrdinal: "0",
      targetMutationId: d("a"),
    });
    const segment = {
      canonicalPointerPath: "installation/active-release.json",
      globalIdentityDigest: d("3"),
      installationId,
      pointerKind: "ACTIVE_RELEASE",
      projectId,
      recordedAt: "2026-08-18T13:59:00.000Z",
      runId,
      runOrdinal: "0",
      schemaVersion: "pointer-mutation-run-segment/v1",
      sourceToken: "none",
      stage: "CURRENT_AUTHORITY_READ",
      stageEvidenceDigest: d("d"),
      stateRootDigest: d("9"),
      targetMutationId: d("a"),
      targetPathInstanceDigest: d("b"),
      transactionId: installationId,
    };
    const segmentDigest = computeRunSegmentDigest(segment);
    const auditDigest = computeRunAuditDigest(null, segmentDigest);
    expect(parseRunSegment(segment).ok).toBe(true);
    expect(segmentDigest).toBe("610bb53e6cc71d253275611d3bac3217f7d3bf44d1d984f5b0e34eeb58ef094a");
    expect(auditDigest).toBe("65e7134e48ed70cb625d06c23761987efb93bb269dfd85c04b55fbc8e29c5e65");
    const core = { ...checkpoint(0), segmentDigest, auditDigest };
    expect(validateRunSegmentCore(segment, core, null)).toEqual([]);
    expect(validateRunSegmentCore(segment, { ...core, segmentDigest: d("e") }, null)).toContain(
      "segmentDigest:mismatch",
    );
    expect(parseRunSegment({ ...segment, recordedAt: "2026-08-18" }).ok).toBe(false);
  });

  test("parses and hashes the exact checkpoint core and selected run-current projection", () => {
    const core = checkpoint(0);
    expect(parseRunCheckpointCore(core).ok).toBe(true);
    expect(parseContract("pointer-mutation-run-checkpoint-core/v1", core).ok).toBe(true);
    expect(computeRunCheckpointCoreDigest(core)).toBe(
      "bde466f0c7870d54d4c2db7e2d8691a6cc10d2ebff6e398501206c5bb3af8931",
    );

    const current = {
      checkpointCoreDigest: computeRunCheckpointCoreDigest(core),
      checkpointOrdinal: "0",
      phase: "CRASH_PREFIX",
      runOrdinal: "0",
      schemaVersion: "pointer-mutation-run-current-value/v1",
      stage: "CURRENT_AUTHORITY_READ",
      targetMutationId: d("a"),
      targetPathInstanceDigest: d("b"),
      terminalResolutionDigest: null,
    };
    expect(parseRunCurrentValue(current).ok).toBe(true);
    expect(parseContract("pointer-mutation-run-current-value/v1", current).ok).toBe(true);
    expect(validateRunCurrentSelection(core, current)).toEqual([]);
    expect(validateRunCurrentSelection(core, { ...current, targetMutationId: d("d") })).toContain(
      "targetMutationId:mismatch",
    );
  });

  test("binds the downstream selector observation without feeding it back into the core", () => {
    const observation = {
      checkpointCoreDigest: computeRunCheckpointCoreDigest(checkpoint(0)),
      observedAt: "2026-08-18T14:00:00.000Z",
      proposalReadbackDigest: d("1"),
      schemaVersion: "pointer-mutation-run-selector-post-selection-observation/v1",
      selectorMutationId: d("2"),
      selectorPathInstanceDigest: d("3"),
      selectorReceiptDigest: d("4"),
      selectorTipDigest: d("5"),
      selectorValueDigest: d("6"),
      tipReadbackDigest: d("7"),
      valueReadbackDigest: d("8"),
    };
    expect(parseRunPostSelectionObservation(observation).ok).toBe(true);
    expect(computeRunPostSelectionObservationDigest(observation)).toBe(
      "ae50fe4a19beb8dae45a1b6cd0ecf9ffbbb29cb12db5922784b08b891ffa44a8",
    );
    expect(parseRunPostSelectionObservation({ ...observation, nextCoreDigest: d("9") }).ok).toBe(
      false,
    );
  });

  test("derives run identity from one selected authority epoch and bounded ordinal", () => {
    const projection = {
      authorityPathInstanceDigest: d("1"),
      authorityReceiptDigest: d("2"),
      authorityTipDigest: d("3"),
      authorityValueDigest: d("4"),
      globalIdentityDigest: d("5"),
      priorCheckpointDigest: null,
      runOrdinal: "9007199254740991",
      targetMutationId: d("6"),
    };
    expect(computeRunId(projection)).toBe(
      "0bcf3fa8e16fec02be7464fb70d164b2d6b09292b0b1b566d265dda12aaa6ed9",
    );
    expect(() => computeRunId({ ...projection, runOrdinal: "9007199254740992" })).toThrow();
    expect(() => computeRunId({ ...projection, priorCheckpointDigest: d("z") })).toThrow();
  });

  test("admits exactly the ordinary nine-stage and rotation six-stage prefixes", () => {
    const ordinary = Array.from({ length: 9 }, (_, index) => checkpoint(index));
    expect(validateCommitCheckpointSequence(ordinary, "ORDINARY")).toEqual([]);

    const rotation = Array.from({ length: 6 }, (_, index) =>
      checkpoint(index, "STATE_MUTATION_AUTHORITY_ROTATION"),
    );
    expect(validateCommitCheckpointSequence(rotation, "AUTHORITY_ROTATION")).toEqual([]);
    expect(validateCommitCheckpointSequence(ordinary.slice(0, 8), "ORDINARY")).toContain(
      "checkpoints:length",
    );
    expect(validateCommitCheckpointSequence(rotation, "ORDINARY")).toContain("checkpoints:length");
    expect(
      validateCommitCheckpointSequence(
        ordinary.map((row, index) =>
          index === 8 ? { ...row, phase: "LOST_CONFLICT", terminalResolutionDigest: d("d") } : row,
        ),
        "ORDINARY",
      ),
    ).toContain("8:phase:not-stage-seven");
  });

  test("fails closed for partial predecessor triples, unsafe ordinals, wrong phases, and extras", () => {
    const core = checkpoint(1);
    expect(parseRunCheckpointCore({ ...core, priorSelectorTipDigest: null }).ok).toBe(false);
    expect(parseRunCheckpointCore({ ...core, checkpointOrdinal: "9007199254740992" }).ok).toBe(
      false,
    );
    expect(parseRunCheckpointCore({ ...core, phase: "SELECTED" }).ok).toBe(false);
    expect(parseRunCheckpointCore({ ...core, selectorTipDigest: d("1") }).ok).toBe(false);
    expect(
      parseRunCheckpointCore(
        new Proxy(core, {
          ownKeys() {
            throw new Error("trap");
          },
        }),
      ).ok,
    ).toBe(false);
  });
});

import { describe, expect, test } from "vitest";
import { canonicalBytes } from "../../packages/contracts/src/index.js";
import { computePortableCustodyProfileDigest } from "../../probes/portable-primitives/src/profiles.js";
import { sha256Bytes } from "../../packages/conformance/src/contracts.js";
import * as decision from "../../packages/conformance/src/portable-primitives-decision.js";
import { checkPortablePrimitivesPublication } from "../../packages/conformance/src/portable-primitives-publication.js";

const bytes = (text: string) => new TextEncoder().encode(text);
const digest = (name: string) => sha256Bytes(bytes(`SYNTHETIC PUBLICATION FIXTURE ONLY: ${name}`));

function fixture(arm: "PASS" | "BLOCK_REPLAN" = "BLOCK_REPLAN") {
  const harness = digest("harness");
  const tests = digest("tests");
  const registry = digest("registry");
  const contracts = digest("contracts");
  const subject = decision.computePortablePrimitivesStableHarnessSubjectDigest(
    harness,
    tests,
    registry,
    contracts,
  );
  const core = {
    aggregateDigest: arm === "PASS" ? digest("aggregate") : null,
    candidateSubjectDigest: digest("candidate"),
    contractVersionsDigest: contracts,
    custodyProfileDigest: computePortableCustodyProfileDigest(),
    decision: arm,
    decisionWriterDigest: decision.computePortablePrimitivesDecisionWriterDigest(
      subject,
      harness,
      tests,
      contracts,
    ),
    diagnosticTerminalDigest: arm === "PASS" ? null : digest("diagnostic-terminal"),
    harnessBundleDigest: harness,
    helperAbiDigests:
      arm === "PASS"
        ? [digest("abi-linux"), digest("abi-macos"), digest("abi-windows")]
        : [null, null, null],
    helperDigests:
      arm === "PASS"
        ? [digest("helper-linux"), digest("helper-macos"), digest("helper-windows")]
        : [null, null, null],
    observationDigests:
      arm === "PASS"
        ? Array.from({ length: 63 }, (_, index) => digest(`observation-${index}`))
        : [],
    osProfileDigests:
      arm === "PASS"
        ? [digest("os-linux"), digest("os-macos"), digest("os-windows")]
        : [null, null, null],
    profile:
      arm === "PASS"
        ? decision.portablePrimitivesCapabilityProfile
        : Object.fromEntries(
            Object.keys(decision.portablePrimitivesCapabilityProfile).map((key) => [key, null]),
          ),
    providerRunDigest: digest("provider-run"),
    requiredJobRegistryDigest: registry,
    schemaVersion: decision.portablePrimitivesDecisionCoreSchemaVersion,
    stableHarnessSubjectDigest: subject,
    testBundleDigest: tests,
  };
  const coreDigest = decision.computePortablePrimitivesCapabilityDecisionCoreDigest(core);
  const review = {
    decisionCoreDigest: coreDigest,
    providerReviewDigest: digest("provider-review"),
    reviewDisposition: arm === "PASS" ? "AUTHORIZE_PASS" : "RECORD_BLOCK_REPLAN",
    reviewedAt: "2026-08-01T00:00:00.000Z",
    reviewerSubjectDigest: digest("reviewer"),
    schemaVersion: decision.portablePrimitivesIndependentReviewSchemaVersion,
  };
  const final = {
    decisionCoreDigest: coreDigest,
    independentReviewReceiptDigest:
      decision.computePortablePrimitivesIndependentReviewDigest(review),
    schemaVersion: decision.portablePrimitivesDecisionSchemaVersion,
  };
  return {
    core,
    review,
    final,
    directory: `planning/decisions/ISS-022/${coreDigest}`,
    files: {
      "decision-core.json": canonicalBytes(core),
      "independent-review.json": canonicalBytes(review),
      "decision.json": canonicalBytes(final),
    },
  };
}

describe("portable primitives publication layout and bytes only", () => {
  test.each(["PASS", "BLOCK_REPLAN"] as const)(
    "checks synthetic %s consistency without admitting authority",
    (arm) => {
      const f = fixture(arm);
      expect(checkPortablePrimitivesPublication(f.directory, f.files)).toEqual({
        ok: true,
        decision: arm,
        decisionCoreDigest: f.final.decisionCoreDigest,
        independentReviewReceiptDigest: f.final.independentReviewReceiptDigest,
        decisionDigest: decision.computePortablePrimitivesCapabilityDecisionDigest(f.final),
      });
    },
  );

  test("refuses missing, extra, aliased, non-data and non-byte files", () => {
    const f = fixture();
    for (const name of Object.keys(f.files)) {
      const missing: Record<string, Uint8Array> = { ...f.files };
      delete missing[name];
      expect(checkPortablePrimitivesPublication(f.directory, missing).ok).toBe(false);
    }
    for (const files of [
      { ...f.files, "extra.json": bytes("{}") },
      { ...f.files, "./decision.json": f.files["decision.json"] },
      { ...f.files, [Symbol("extra")]: true },
      { ...f.files, "decision.json": "{}" },
      {
        ...f.files,
        get "decision.json"() {
          throw new Error("must not execute");
        },
      },
      new Proxy(f.files, {
        ownKeys() {
          throw new Error("must not execute");
        },
      }),
      null,
    ])
      expect(checkPortablePrimitivesPublication(f.directory, files).ok).toBe(false);
  });

  test("refuses alternate directories, malformed/noncanonical bytes and broken joins", () => {
    const f = fixture();
    for (const path of [
      null,
      `${f.directory}/`,
      f.directory.toUpperCase(),
      `./${f.directory}`,
      `${f.directory}/..`,
      `planning/decisions/ISS-022/${digest("foreign")}`,
    ])
      expect(checkPortablePrimitivesPublication(path, f.files).ok).toBe(false);
    for (const name of Object.keys(f.files) as Array<keyof typeof f.files>) {
      for (const changed of [
        bytes("{"),
        bytes("{}"),
        new Uint8Array([0xff]),
        bytes(`\ufeff${new TextDecoder().decode(f.files[name])}`),
        bytes(`${new TextDecoder().decode(f.files[name])}\n`),
      ])
        expect(
          checkPortablePrimitivesPublication(f.directory, { ...f.files, [name]: changed }).ok,
        ).toBe(false);
    }
    for (const changed of [
      {
        "decision-core.json": canonicalBytes({
          ...f.core,
          candidateSubjectDigest: digest("foreign"),
        }),
      },
      {
        "independent-review.json": canonicalBytes({
          ...f.review,
          decisionCoreDigest: digest("foreign"),
        }),
      },
      {
        "independent-review.json": canonicalBytes({
          ...f.review,
          reviewDisposition: "AUTHORIZE_PASS",
        }),
      },
      { "decision.json": canonicalBytes({ ...f.final, decisionCoreDigest: digest("foreign") }) },
      {
        "decision.json": canonicalBytes({
          ...f.final,
          independentReviewReceiptDigest: digest("foreign"),
        }),
      },
    ])
      expect(checkPortablePrimitivesPublication(f.directory, { ...f.files, ...changed }).ok).toBe(
        false,
      );
  });
});

import { lstat, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  canonicalJson,
  computeDispatchContentReference,
  computeDispatchPlanDigest,
  computeModuleDescriptorDigest,
  computeReviewAttemptResultDigest,
  computeReviewPacketDigest,
  computeReviewRequestDigest,
  computeWorkerLaunchReceiptDigest,
  computeWorkerResultSubjectDigest,
  computeWorkerTerminalReceiptDigest,
  parseCanonicalContractBytes,
  parseReviewAttemptResult,
  parseWorkerResultSubject,
  validateReviewResultBinding,
  validateWorkerTerminalReceiptBinding,
  type DispatchPlan,
  type ReviewRequest,
  type WorkerLaunchReceipt,
  type WorkerTerminalReceipt,
} from "@orchestration-platform/contracts";
import { descriptor } from "./review-module.js";

const expected = Buffer.from("fixture reviewed artifact v1\n");
const procedure = Buffer.from(
  "fixture-only review: compare the retained artifact with the fixed expected bytes\n",
);

async function retainedFile(path: string) {
  const before = await lstat(path, { bigint: true });
  if (
    !before.isFile() ||
    before.nlink !== 1n ||
    before.size > 1048576n ||
    (await realpath(path)) !== path
  )
    throw new Error("fixture review file admission refused");
  const handle = await open(path, "r");
  try {
    const opened = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    const after = await lstat(path, { bigint: true });
    if (
      [opened, after].some(
        (row) =>
          row.dev !== before.dev ||
          row.ino !== before.ino ||
          row.mode !== before.mode ||
          row.size !== before.size ||
          row.nlink !== 1n,
      ) ||
      BigInt(bytes.length) !== before.size
    )
      throw new Error("fixture review file changed");
    return bytes;
  } finally {
    await handle.close();
  }
}

// These explicit files seed prior history. This does not claim that an author cycle was executed.
export async function readReviewSeed(projectRoot: string) {
  const subjectBytes = await retainedFile(join(projectRoot, "fixture-review-subject.json"));
  const canonical = parseCanonicalContractBytes("worker-result-subject/v1", subjectBytes);
  const subject = canonical.ok ? parseWorkerResultSubject(canonical.value) : canonical;
  if (!subject.ok) throw new Error("fixture review subject refused");
  const artifact = await retainedFile(join(projectRoot, "fixture-review-artifact.bin"));
  const materialized = subject.value.result;
  if (
    subject.value.baseSource.revision !== "fixture.seed.v1" ||
    materialized.kind !== "ORDERED_PATCH_ARTIFACTS" ||
    materialized.entries.length !== 1 ||
    materialized.entries[0]!.kind !== "ARTIFACT" ||
    materialized.entries[0]!.contentDigest !==
      computeDispatchContentReference(artifact).contentDigest
  )
    throw new Error("fixture seed materialization refused");
  // Bracket the two-file read under the cooperative fixture source. No hostile-writer atomicity claim.
  if (!(await retainedFile(join(projectRoot, "fixture-review-subject.json"))).equals(subjectBytes))
    throw new Error("fixture review subject moved");
  return {
    subject: subject.value,
    subjectBytes,
    artifact,
    expected: Buffer.from(expected),
    procedure: Buffer.from(procedure),
  };
}
export type ReviewSeed = Awaited<ReturnType<typeof readReviewSeed>>;
export const reviewEvidence = (seed: ReviewSeed) =>
  [seed.artifact, seed.expected, seed.procedure].map((bytes) =>
    computeDispatchContentReference(bytes),
  );

// Fixed independent stub reduction, quarantined evidence only. No production review authority.
export function reduceFixtureReview(
  seed: ReviewSeed,
  request: ReviewRequest,
  plan: DispatchPlan,
  launch: WorkerLaunchReceipt,
  terminal: WorkerTerminalReceipt,
  stdout: Uint8Array,
  stderr: Uint8Array,
) {
  const attempt = observeFixtureReviewAttempt(
    seed,
    request,
    plan,
    launch,
    terminal,
    stdout,
    stderr,
  );
  const authority = reduceFixtureReviewAuthority(seed, request, attempt);
  return { request, attempt, authority };
}

/** Step-9 materialization only; it does not decide review authority. */
export function observeFixtureReviewAttempt(
  seed: ReviewSeed,
  request: ReviewRequest,
  plan: DispatchPlan,
  launch: WorkerLaunchReceipt,
  terminal: WorkerTerminalReceipt,
  stdout: Uint8Array,
  stderr: Uint8Array,
) {
  if (
    canonicalJson(request.packet.subject) !== canonicalJson(seed.subject) ||
    !validateWorkerTerminalReceiptBinding(plan, launch, stdout, stderr, terminal).ok ||
    terminal.outcome.kind !== "EXITED" ||
    terminal.outcome.exit.kind !== "EXIT_CODE" ||
    terminal.outcome.exit.value !== "0"
  )
    throw new Error("fixture review execution refused");
  const accepted = seed.artifact.equals(expected);
  const identities = {
    packetDigest: computeReviewPacketDigest(request.packet),
    requestDigest: computeReviewRequestDigest(request),
    subjectDigest: computeWorkerResultSubjectDigest(seed.subject),
  };
  const evidence = reviewEvidence(seed);
  const attempt = parseReviewAttemptResult({
    attemptId: plan.attemptId,
    cycleId: request.reviewCycleId,
    dispatchPlanDigest: computeDispatchPlanDigest(plan),
    launchReceiptDigest: computeWorkerLaunchReceiptDigest(launch),
    ...identities,
    result: accepted
      ? { evidence, kind: "SWEEP_COMPLETE" }
      : {
          evidence,
          kind: "BLOCKED",
          findings: [
            {
              disposition: {
                code: "review.reject",
                moduleDescriptorDigest: computeModuleDescriptorDigest(descriptor),
              },
              evidence: {
                expected: computeDispatchContentReference(expected),
                observed: computeDispatchContentReference(seed.artifact),
                procedure: computeDispatchContentReference(procedure),
              },
              findingId: "fixture.artifact-mismatch",
            },
          ],
        },
    schemaVersion: "review-attempt-result/v1",
    terminalReceiptDigest: computeWorkerTerminalReceiptDigest(terminal),
  });
  if (!attempt.ok) throw new Error(attempt.issues.join(","));
  return attempt.value;
}

/** Step-10 fixed independent reduction over an already retained attempt. */
export function reduceFixtureReviewAuthority(
  seed: ReviewSeed,
  request: ReviewRequest,
  attempt: ReturnType<typeof observeFixtureReviewAttempt>,
) {
  const identities = {
    packetDigest: computeReviewPacketDigest(request.packet),
    requestDigest: computeReviewRequestDigest(request),
    subjectDigest: computeWorkerResultSubjectDigest(seed.subject),
  };
  const authority = validateReviewResultBinding(request, attempt, {
    ...identities,
    outcome: {
      attemptResultDigest: computeReviewAttemptResultDigest(attempt),
      kind: attempt.result.kind === "SWEEP_COMPLETE" ? "accepted" : "rejected",
    },
    schemaVersion: "review-authority/v1",
  });
  if (!authority.ok) throw new Error(authority.issues.join(","));
  return authority.value;
}

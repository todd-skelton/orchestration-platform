import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AcceptedReplan, PreReviewEvidence } from "../../../scripts/dogfood/continuation.js";

export const ACCEPTED_REPLAN = {
  run: "m2-jpeg-corrective-20260914T1402",
  priorRun: "m2-jpeg-20260914",
  slug: "cs-7766-replan-8014-attempt-5",
};
const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
export function replanPacket(
  stateRoot: string,
  head = "b".repeat(40),
  history: unknown[] = [],
): AcceptedReplan {
  return {
    schemaVersion: "dogfood-accepted-replan/v1",
    repository: "chase-sets/chase-sets",
    issueKey: "cs-7766",
    issueUrl: "https://github.com/chase-sets/chase-sets/issues/7766",
    priorRun: ACCEPTED_REPLAN.priorRun,
    priorAttemptDirectory: resolve(stateRoot, ACCEPTED_REPLAN.priorRun, "cs-7766-attempt-4"),
    priorAbsoluteAttempt: 4,
    priorHistoryDigest: hash(JSON.stringify(history)),
    candidateHead: head,
    targetRun: ACCEPTED_REPLAN.run,
    attemptSlug: ACCEPTED_REPLAN.slug,
    nextAbsoluteAttempt: 5,
    absoluteCeiling: 5,
    authorityUrl: "https://github.com/chase-sets/chase-sets/issues/4388#issuecomment-5665159522",
    scope: "Correct the route-collision inventory failure only",
    allowedPaths: ["jpeg.txt"],
    publication: {
      number: 8005,
      url: "https://github.com/chase-sets/chase-sets/pull/8005",
      head,
      sourceBranch: "codex/7766-jpeg-g4",
    },
    preReviewEvidence: null,
  };
}
export function evidenceDescriptor(root: string): PreReviewEvidence {
  return {
    receiptSchema: "dogfood-host-verification/v1",
    workspace: "Ordering",
    gate: "real-postgresql",
    command: { executable: "pnpm", args: ["test:ordering"] },
    bundle: {
      receipt: resolve(root, "receipt.json"),
      runMetadata: resolve(root, "run.json"),
      preflightLog: resolve(root, "preflight.log"),
      verifierLog: resolve(root, "verifier.log"),
    },
    files: 18,
    tests: 386,
    skips: 0,
    requiredCases: [
      "purchase-limit-source-retry-concurrency day +0",
      "purchase-limit-source-retry-concurrency day +1",
    ],
  };
}
export async function writeEvidence(
  descriptor: PreReviewEvidence,
  repository: string,
  head: string,
  changes: Record<string, unknown> = {},
  mutate?: (receipt: Record<string, any>) => void,
) {
  const result = {
    repository,
    head,
    workspace: descriptor.workspace,
    gate: descriptor.gate,
    command: descriptor.command,
    runId: "host-run-1",
    exitCode: 0,
    files: descriptor.files,
    tests: descriptor.tests,
    skips: 0,
    cases: descriptor.requiredCases,
    ...changes,
  };
  const artifacts = {
    runMetadata: JSON.stringify({ schemaVersion: "dogfood-host-verification-run/v1", ...result }),
    preflightLog: "PostgreSQL preflight completed\n",
    verifierLog: "Complete Ordering execution\n",
  };
  const receipt = {
    schemaVersion: descriptor.receiptSchema,
    ...result,
    artifacts: Object.fromEntries(
      Object.entries(artifacts).map(([name, bytes]) => [name, hash(bytes)]),
    ),
  };
  mutate?.(receipt);
  const bundle = { receipt: JSON.stringify(receipt), ...artifacts };
  for (const name of Object.keys(bundle) as (keyof typeof bundle)[]) {
    const path = descriptor.bundle[name];
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bundle[name]);
  }
}

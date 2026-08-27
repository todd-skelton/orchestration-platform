import { createHash } from "node:crypto";

export type WorkflowStructureResult =
  { readonly ok: true } | { readonly ok: false; readonly issues: readonly string[] };

const expectedDigest = "fda0ed4c5fc23f560afa62cb20cc4ac059c1cd94d9feb76314ef3bb671683639";
const actionShaPattern =
  /^[ ]+uses: actions\/(?:checkout|setup-node|upload-artifact|download-artifact)@[0-9a-f]{40}$/;

function refusal(...issues: readonly string[]): WorkflowStructureResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

export function validateConformanceWorkflowSource(source: unknown): WorkflowStructureResult {
  if (typeof source !== "string" || source.includes("\r") || !source.endsWith("\n")) {
    return refusal("workflow:canonical-lf-source-required");
  }
  const issues: string[] = [];
  const digest = createHash("sha256").update(source, "utf8").digest("hex");
  if (digest !== expectedDigest) issues.push("workflow:reviewed-source-digest-mismatch");

  const uses = source.split("\n").filter((line) => line.trimStart().startsWith("uses:"));
  if (uses.length !== 14 || uses.some((line) => !actionShaPattern.test(line))) {
    issues.push("workflow:remote-action-census-refused");
  }
  for (const forbidden of [
    "workflow_dispatch:",
    "pull_request:",
    "push:",
    "continue-on-error:",
    "self-hosted",
    "permissions: write-all",
    "id-token: write",
    "contents: write",
    "actions: write",
    "secrets:",
    "environment:",
    "actions/cache@",
    "stable/.conformance/observation",
    "stable/.conformance/aggregate",
    "stable/.conformance/conformance-",
    "node scripts/conformance/hosted.mts ",
  ]) {
    if (source.includes(forbidden)) issues.push(`workflow:forbidden:${forbidden}`);
  }
  for (const required of [
    "types: [conformance_candidate]",
    "actions: read",
    "contents: read",
    "candidateRevision: ${{ steps.select.outputs.candidateRevision }}",
    "matrix: ${{ fromJSON(needs.plan.outputs.matrix) }}",
    "name: observation / ${{ matrix.jobId }}",
    "needs: [plan, observation]",
    "needs: [plan, observation, aggregate]",
    "persist-credentials: false",
    "archive: true",
    "archive: false",
    "retention-days: 31",
    "node scripts/conformance/run-bundled.mts hosted plan-select",
    "node scripts/conformance/run-bundled.mts hosted plan-finalize",
    "node scripts/conformance/run-bundled.mts hosted observation",
    "CONFORMANCE_OUTPUT_ROOT: ${{ runner.temp }}/conformance-observation",
    "path: ${{ runner.temp }}/conformance-observation",
    "CONFORMANCE_DOWNLOAD_ROOT: ${{ runner.temp }}/conformance-downloads",
    "CONFORMANCE_OUTPUT_ROOT: ${{ runner.temp }}/conformance-aggregate",
    "path: ${{ runner.temp }}/conformance-downloads",
    "path: ${{ runner.temp }}/conformance-aggregate",
    "node scripts/conformance/run-bundled.mts hosted aggregate",
    "node scripts/conformance/run-bundled.mts hosted record",
    "CONFORMANCE_OUTPUT_ROOT: ${{ runner.temp }}/conformance-record",
    "path: ${{ runner.temp }}/conformance-record/conformance-${{ github.run_id }}-${{ github.run_attempt }}-provider-record.json",
  ]) {
    if (!source.includes(required)) issues.push(`workflow:required:${required}`);
  }
  return issues.length === 0 ? { ok: true } : refusal(...issues);
}

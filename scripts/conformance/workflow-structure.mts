import { createHash } from "node:crypto";

export type WorkflowStructureResult =
  { readonly ok: true } | { readonly ok: false; readonly issues: readonly string[] };

const expectedDigest = "94b1b6d881aa1e37015291defe88ed81f79863c1152b5b16b565cd8429334088";
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
  if (uses.length !== 15 || uses.some((line) => !actionShaPattern.test(line))) {
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
    "node scripts/conformance/hosted.mts plan-select",
    "node scripts/conformance/hosted.mts plan-finalize",
    "node scripts/conformance/hosted.mts observation",
    "CONFORMANCE_OUTPUT_ROOT: ${{ runner.temp }}/conformance-observation",
    "path: ${{ runner.temp }}/conformance-observation",
    "CONFORMANCE_DOWNLOAD_ROOT: ${{ runner.temp }}/conformance-downloads",
    "CONFORMANCE_OUTPUT_ROOT: ${{ runner.temp }}/conformance-aggregate",
    "path: ${{ runner.temp }}/conformance-downloads",
    "path: ${{ runner.temp }}/conformance-aggregate",
    "node scripts/conformance/hosted.mts aggregate",
    "node scripts/conformance/hosted.mts record",
  ]) {
    if (!source.includes(required)) issues.push(`workflow:required:${required}`);
  }
  return issues.length === 0 ? { ok: true } : refusal(...issues);
}

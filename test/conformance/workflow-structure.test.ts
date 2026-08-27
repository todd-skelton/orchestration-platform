import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { validateConformanceWorkflowSource } from "../../scripts/conformance/workflow-structure.mjs";

const workflowPath = resolve(import.meta.dirname, "../../.github/workflows/conformance.yml");
const hostedPath = resolve(import.meta.dirname, "../../scripts/conformance/hosted.mts");

async function source(): Promise<string> {
  return readFile(workflowPath, "utf8");
}

function replaceOnce(input: string, from: string, to: string): string {
  expect(input).toContain(from);
  const mutant = input.replace(from, to);
  expect(mutant).not.toBe(input);
  return mutant;
}

describe("protected conformance workflow structure", () => {
  test("accepts only the reviewed repository_dispatch topology", async () => {
    expect(validateConformanceWorkflowSource(await source())).toEqual({ ok: true });
  });

  test.each([
    ["alternate event", "types: [conformance_candidate]", "types: [candidate]"],
    [
      "mutable checkout",
      "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
      "actions/checkout@v6",
    ],
    [
      "mutable setup",
      "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
      "actions/setup-node@main",
    ],
    [
      "mutable upload",
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
      "actions/upload-artifact@v7",
    ],
    [
      "mutable download",
      "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
      "actions/download-artifact@v8",
    ],
    [
      "candidate before stable selection",
      "node scripts/conformance/hosted.mts plan-select",
      "node scripts/conformance/hosted.mts observation",
    ],
    [
      "hard-coded matrix",
      "matrix: ${{ fromJSON(needs.plan.outputs.matrix) }}",
      "matrix: { os: [ubuntu-latest] }",
    ],
    ["excluded matrix row", "fail-fast: false", "exclude: [{ jobId: iss002-contracts-macos }]"],
    ["local-hosted substitution", "runs-on: ${{ matrix.runner }}", "runs-on: self-hosted"],
    [
      "aggregate writer in candidate job",
      "node scripts/conformance/hosted.mts observation",
      "node scripts/conformance/hosted.mts aggregate",
    ],
    ["observation archive disabled", "archive: true", "archive: false"],
    [
      "observation output in the checkout",
      "${{ runner.temp }}/conformance-observation",
      "stable/.conformance/observation",
    ],
    [
      "aggregate output in the checkout",
      "${{ runner.temp }}/conformance-aggregate",
      "stable/.conformance/aggregate",
    ],
    ["provider record archived", "archive: false", "archive: true"],
    [
      "fixed provider filename",
      "conformance-${{ github.run_id }}-${{ github.run_attempt }}-provider-record.json",
      "provider-record.json",
    ],
    [
      "prior-attempt artifact name",
      "${{ github.run_attempt }}-${{ matrix.jobId }}",
      "1-${{ matrix.jobId }}",
    ],
    ["short retention", "retention-days: 31", "retention-days: 1"],
    ["write token", "contents: read", "contents: write"],
    ["unprotected ref", "ref: ${{ github.sha }}", "ref: main"],
    ["persisted checkout token", "persist-credentials: false", "persist-credentials: true"],
  ])("rejects the %s mutant", async (_name, from, to) => {
    const mutant = replaceOnce(await source(), from, to);
    expect(validateConformanceWorkflowSource(mutant)).toMatchObject({ ok: false });
  });

  test.each([
    ["manual trigger", "  workflow_dispatch:\n"],
    ["continue-on-error", "    continue-on-error: true\n"],
    ["OIDC", "  id-token: write\n"],
    ["environment", "    environment: production\n"],
    ["secret surface", "    secrets: inherit\n"],
  ])("rejects the added %s mutant", async (_name, inserted) => {
    const mutant = (await source()).replace(
      "  repository_dispatch:\n",
      `${inserted}  repository_dispatch:\n`,
    );
    expect(validateConformanceWorkflowSource(mutant)).toMatchObject({ ok: false });
  });

  test.each(["record"])(
    "keeps the %s hosted mode fail-closed until its implementation lands",
    (mode) => {
      const result = spawnSync(process.execPath, [hostedPath, mode], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`HOSTED_CONFORMANCE_PENDING:${mode}`);
    },
  );

  test("refuses the implemented observation mode without provider inputs", () => {
    const result = spawnSync(process.execPath, [hostedPath, "observation"], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("HOSTED_CONFORMANCE_REFUSED:observation");
    expect(result.stderr).not.toContain("HOSTED_CONFORMANCE_PENDING:observation");
  });

  test("refuses the implemented aggregate mode without provider inputs", () => {
    const result = spawnSync(process.execPath, [hostedPath, "aggregate"], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("HOSTED_CONFORMANCE_REFUSED:aggregate");
    expect(result.stderr).not.toContain("HOSTED_CONFORMANCE_PENDING:aggregate");
  });

  test.each(["plan-select", "plan-finalize"])(
    "refuses the implemented %s mode without provider inputs",
    (mode) => {
      const result = spawnSync(process.execPath, [hostedPath, mode], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`HOSTED_CONFORMANCE_REFUSED:${mode}`);
    },
  );
});

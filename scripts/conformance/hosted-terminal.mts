import { execFile } from "node:child_process";
import { promisify, types as nodeTypes } from "node:util";
import type { ContractRecord } from "../../packages/contracts/src/index.js";
import {
  parseGithubConformanceProviderRecord,
  projectGithubProtectionSnapshot,
  verifyGithubTerminalEvidence,
  type GithubProtectionApiInput,
  type GithubTerminalVerificationResult,
} from "../../packages/conformance/src/github-actions/index.js";
import { githubPlanApi } from "./hosted-plan.mjs";
import { loadHostedIss002StableInputs } from "./hosted-observation.mjs";
import { canonicalGithubDateHeader, type GithubFetch } from "./hosted-record-api.mjs";

const execFileAsync = promisify(execFile);
const revisionPattern = /^[0-9a-f]{40}$/;
const digestPattern = /^sha256:([0-9a-f]{64})$/;

export interface HostedTerminalExpected {
  readonly repositoryId: string;
  readonly runAttempt: string;
  readonly runId: string;
  readonly workflowRevision: string;
}

export interface HostedTerminalRuntime {
  readonly fetcher: GithubFetch;
  readonly projectProtection: (
    repository: string,
    token: string,
  ) => Promise<GithubProtectionApiInput>;
}

const githubTerminalRuntime: HostedTerminalRuntime = Object.freeze({
  fetcher: fetch,
  projectProtection: githubPlanApi.projectProtection,
});

function refusal(...issues: readonly string[]): GithubTerminalVerificationResult {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function dataRecord(input: unknown): Readonly<Record<string, unknown>> | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return undefined;
  return input as Readonly<Record<string, unknown>>;
}

function dataValue(record: Readonly<Record<string, unknown>>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true)
    throw new TypeError(`provider:${key}:data-field-required`);
  return descriptor.value;
}

function positiveDecimal(input: unknown): string | undefined {
  return typeof input === "number" && Number.isSafeInteger(input) && input > 0
    ? String(input)
    : undefined;
}

function expectedDecimal(input: string): boolean {
  return /^[1-9][0-9]*$/.test(input) && Number.isSafeInteger(Number(input));
}

function canonicalTimestamp(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const milliseconds = new Date(input).valueOf();
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined;
}

async function request(
  url: string,
  token: string,
  runtime: HostedTerminalRuntime,
): Promise<Response> {
  if (!token) throw new TypeError("provider:token-required");
  const response = await runtime.fetcher(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new TypeError(`provider:http-${response.status}`);
  return response;
}

async function repositoryName(
  expected: HostedTerminalExpected,
  token: string,
  runtime: HostedTerminalRuntime,
): Promise<string> {
  const response = await request(
    `https://api.github.com/repositories/${expected.repositoryId}`,
    token,
    runtime,
  );
  const body = dataRecord(await response.json());
  const id = body && positiveDecimal(dataValue(body, "id"));
  const fullName = body && dataValue(body, "full_name");
  if (
    id !== expected.repositoryId ||
    typeof fullName !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)
  )
    throw new TypeError("provider:repository-refused");
  return fullName;
}

export async function readGithubTerminalRun(
  repository: string,
  expected: HostedTerminalExpected,
  token: string,
  runtime: HostedTerminalRuntime,
): Promise<ContractRecord> {
  const response = await request(
    `https://api.github.com/repos/${repository}/actions/runs/${expected.runId}`,
    token,
    runtime,
  );
  const row = dataRecord(await response.json());
  if (!row) throw new TypeError("provider:run-record-refused");
  const repositoryRecord = dataRecord(dataValue(row, "repository"));
  const path = dataValue(row, "path");
  const workflowPath =
    typeof path === "string" ? path.replace(/@refs\/heads\/main$/, "") : undefined;
  return Object.freeze({
    conclusion: String(dataValue(row, "conclusion")).toUpperCase(),
    event: dataValue(row, "event"),
    repositoryId: repositoryRecord && positiveDecimal(dataValue(repositoryRecord, "id")),
    runAttempt: positiveDecimal(dataValue(row, "run_attempt")),
    runId: positiveDecimal(dataValue(row, "id")),
    status: String(dataValue(row, "status")).toUpperCase(),
    workflowPath,
    workflowRef: `${repository}/.github/workflows/conformance.yml@refs/heads/main`,
    workflowRevision: dataValue(row, "head_sha"),
  }) as ContractRecord;
}

export async function readGithubTerminalJobs(
  repository: string,
  expected: HostedTerminalExpected,
  token: string,
  runtime: HostedTerminalRuntime,
): Promise<readonly ContractRecord[]> {
  const rows: ContractRecord[] = [];
  let total: number | undefined;
  for (let page = 1; page <= 4; page += 1) {
    const response = await request(
      `https://api.github.com/repos/${repository}/actions/runs/${expected.runId}/attempts/${expected.runAttempt}/jobs?per_page=100&page=${page}`,
      token,
      runtime,
    );
    if (!canonicalGithubDateHeader(response.headers.get("date")))
      throw new TypeError("provider:jobs-date-refused");
    const body = dataRecord(await response.json());
    const pageRows = body && dataValue(body, "jobs");
    const count = body && dataValue(body, "total_count");
    if (!Array.isArray(pageRows) || !Number.isSafeInteger(count) || (count as number) > 259)
      throw new TypeError("provider:jobs-page-refused");
    if (total === undefined) total = count as number;
    else if (total !== count) throw new TypeError("provider:jobs-count-moved");
    for (const input of pageRows) {
      const row = dataRecord(input);
      if (!row) throw new TypeError("provider:job-row-refused");
      const name = dataValue(row, "name");
      if (
        dataValue(row, "workflow_name") !== "Conformance" ||
        dataValue(row, "head_sha") !== expected.workflowRevision ||
        positiveDecimal(dataValue(row, "run_id")) !== expected.runId ||
        positiveDecimal(dataValue(row, "run_attempt")) !== expected.runAttempt ||
        typeof name !== "string"
      )
        throw new TypeError("provider:job-association-refused");
      rows.push(
        Object.freeze({
          completedAt: canonicalTimestamp(dataValue(row, "completed_at")),
          conclusion: String(dataValue(row, "conclusion")).toUpperCase(),
          providerJobId: positiveDecimal(dataValue(row, "id")),
          providerJobName: `Conformance / ${name}`,
          startedAt: canonicalTimestamp(dataValue(row, "started_at")),
        }) as ContractRecord,
      );
    }
    if (pageRows.length < 100) break;
  }
  if (rows.length !== total) throw new TypeError("provider:jobs-terminal-census-refused");
  return Object.freeze(rows);
}

export async function readGithubTerminalArtifacts(
  repository: string,
  expected: HostedTerminalExpected,
  token: string,
  runtime: HostedTerminalRuntime,
): Promise<{
  readonly artifacts: readonly ContractRecord[];
  readonly bytes: readonly Readonly<{ artifactId: string; bytes: Uint8Array }>[];
  readonly providerRecordBytes: Uint8Array;
}> {
  const prefix = `conformance-${expected.runId}-${expected.runAttempt}-`;
  const rows: ContractRecord[] = [];
  const downloads: Array<Readonly<{ artifactId: string; bytes: Uint8Array }>> = [];
  let providerRecordBytes: Uint8Array | undefined;
  let total: number | undefined;
  let collected = 0;
  for (let page = 1; page <= 1024; page += 1) {
    const response = await request(
      `https://api.github.com/repos/${repository}/actions/runs/${expected.runId}/artifacts?per_page=100&page=${page}`,
      token,
      runtime,
    );
    const body = dataRecord(await response.json());
    const pageRows = body && dataValue(body, "artifacts");
    const count = body && dataValue(body, "total_count");
    if (!Array.isArray(pageRows) || !Number.isSafeInteger(count) || (count as number) > 4096)
      throw new TypeError("provider:artifacts-page-refused");
    if (total === undefined) total = count as number;
    else if (total !== count) throw new TypeError("provider:artifacts-count-moved");
    collected += pageRows.length;
    for (const input of pageRows) {
      const row = dataRecord(input);
      if (!row) throw new TypeError("provider:artifact-row-refused");
      const name = dataValue(row, "name");
      if (typeof name !== "string" || !name.startsWith(prefix)) continue;
      const id = positiveDecimal(dataValue(row, "id"));
      const digest = dataValue(row, "digest");
      const match = typeof digest === "string" ? digest.match(digestPattern) : null;
      const workflowRun = dataRecord(dataValue(row, "workflow_run"));
      const url = dataValue(row, "archive_download_url");
      if (
        !id ||
        !match ||
        typeof url !== "string" ||
        url !== `https://api.github.com/repos/${repository}/actions/artifacts/${id}/zip` ||
        dataValue(row, "expired") !== false ||
        !workflowRun ||
        positiveDecimal(dataValue(workflowRun, "id")) !== expected.runId ||
        positiveDecimal(dataValue(workflowRun, "repository_id")) !== expected.repositoryId ||
        dataValue(workflowRun, "head_sha") !== expected.workflowRevision
      )
        throw new TypeError("provider:artifact-association-refused");
      const download = await request(url, token, runtime);
      const bytes = new Uint8Array(await download.arrayBuffer());
      rows.push(
        Object.freeze({
          artifactDigest: match[1],
          artifactId: id,
          artifactName: name,
          byteLength: positiveDecimal(dataValue(row, "size_in_bytes")),
          createdAt: canonicalTimestamp(dataValue(row, "created_at")),
          expired: false,
          expiresAt: canonicalTimestamp(dataValue(row, "expires_at")),
          runAttempt: expected.runAttempt,
          runId: expected.runId,
        }) as ContractRecord,
      );
      downloads.push(Object.freeze({ artifactId: id, bytes }));
      if (name === `${prefix}provider-record.json`) {
        if (providerRecordBytes) throw new TypeError("provider:record-artifact-duplicate");
        providerRecordBytes = bytes;
      }
    }
    if (pageRows.length < 100) break;
  }
  if (collected !== total || !providerRecordBytes)
    throw new TypeError("provider:artifacts-terminal-census-refused");
  return Object.freeze({
    artifacts: Object.freeze(rows),
    bytes: Object.freeze(downloads),
    providerRecordBytes,
  });
}

function providerRunFromRecord(record: ContractRecord): ContractRecord {
  return Object.freeze({
    candidateRevision: record.candidateRevision,
    candidateSubjectDigest: record.candidateSubjectDigest,
    event: record.event,
    harnessBundleDigest: record.harnessBundleDigest,
    protectionSnapshotDigest: record.protectionSnapshotDigest,
    repositoryId: record.repositoryId,
    requiredJobRegistryDigest: record.requiredJobRegistryDigest,
    runAttempt: record.runAttempt,
    runId: record.runId,
    testBundleDigest: record.testBundleDigest,
    workflowPath: record.workflowPath,
    workflowRef: record.workflowRef,
    workflowRevision: record.workflowRevision,
  }) as unknown as ContractRecord;
}

export async function verifyHostedTerminalFromGithub(
  expected: HostedTerminalExpected,
  token: string,
  stableRoot = process.cwd(),
  runtime: HostedTerminalRuntime = githubTerminalRuntime,
): Promise<GithubTerminalVerificationResult> {
  try {
    if (
      !expectedDecimal(expected.repositoryId) ||
      !expectedDecimal(expected.runId) ||
      !expectedDecimal(expected.runAttempt) ||
      !revisionPattern.test(expected.workflowRevision) ||
      !token
    )
      return refusal("expected:refused");
    const [headResult, statusResult] = await Promise.all([
      execFileAsync("git", ["-C", stableRoot, "rev-parse", "HEAD"], { windowsHide: true }),
      execFileAsync(
        "git",
        ["-C", stableRoot, "status", "--porcelain=v1", "--untracked-files=all"],
        {
          windowsHide: true,
        },
      ),
    ]);
    const head = String(headResult.stdout).trim();
    if (head !== expected.workflowRevision) return refusal("stable:workflow-revision-mismatch");
    if (String(statusResult.stdout).length !== 0) return refusal("stable:checkout-not-clean");
    const stable = await loadHostedIss002StableInputs(stableRoot);
    if (!stable) return refusal("stable:inputs-refused");
    const repository = await repositoryName(expected, token, runtime);
    const [run, jobs, artifacts, protection] = await Promise.all([
      readGithubTerminalRun(repository, expected, token, runtime),
      readGithubTerminalJobs(repository, expected, token, runtime),
      readGithubTerminalArtifacts(repository, expected, token, runtime),
      runtime.projectProtection(repository, token),
    ]);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(artifacts.providerRecordBytes);
    const parsedRecord = parseGithubConformanceProviderRecord(JSON.parse(text));
    if (!parsedRecord.ok) return refusal(...parsedRecord.issues);
    const projectedProtection = projectGithubProtectionSnapshot(protection);
    if (!projectedProtection.ok) return refusal(...projectedProtection.issues);
    return verifyGithubTerminalEvidence({
      artifactBytes: artifacts.bytes,
      currentProtectionSnapshot: projectedProtection.value,
      expected,
      liveArtifacts: artifacts.artifacts,
      liveJobs: jobs,
      liveRun: run,
      providerRecordBytes: artifacts.providerRecordBytes,
      providerRun: providerRunFromRecord(parsedRecord.value),
      registry: stable.registry,
    });
  } catch {
    return refusal("terminalProvider:unreadable");
  }
}

import { types as nodeTypes } from "node:util";
import type { ContractRecord } from "../../packages/contracts/src/index.js";
import { parseConformanceRequiredJobRegistry } from "../../packages/conformance/src/index.js";
import type { HostedPlanContext } from "./hosted-plan.mjs";

export type HostedRecordApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly string[] };

export interface GithubHostedArtifactEvidence {
  readonly archiveBytes: Uint8Array;
  readonly artifactDigest: string;
  readonly artifactId: string;
  readonly artifactName: string;
  readonly byteLength: string;
  readonly expiresAt: string;
}

export interface GithubHostedJobEvidence {
  readonly conclusion: "SUCCESS";
  readonly providerJobId: string;
  readonly providerJobName: string;
}

export type GithubFetch = (input: string, init: RequestInit) => Promise<Response>;

const digestPattern = /^sha256:([0-9a-f]{64})$/;

function refusal<T>(...issues: readonly string[]): HostedRecordApiResult<T> {
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

function safePositiveDecimal(input: unknown): string | undefined {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input <= 0) return undefined;
  return String(input);
}

function canonicalTimestamp(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const milliseconds = new Date(input).valueOf();
  if (!Number.isFinite(milliseconds)) return undefined;
  const canonical = new Date(milliseconds).toISOString();
  return new Date(canonical).valueOf() === milliseconds ? canonical : undefined;
}

export function canonicalGithubDateHeader(input: unknown): string | undefined {
  if (
    typeof input !== "string" ||
    !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/.test(
      input,
    )
  )
    return undefined;
  const milliseconds = new Date(input).valueOf();
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toUTCString() !== input)
    return undefined;
  return new Date(milliseconds).toISOString();
}

async function githubRequest(url: string, token: string, fetcher: GithubFetch): Promise<Response> {
  if (!token) throw new TypeError("provider:token-required");
  const response = await fetcher(url, {
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

function expectedJobNames(registry: ContractRecord): ReadonlyMap<string, string> {
  const rows = registry.jobs as readonly ContractRecord[];
  return new Map([
    ["aggregate", "AGGREGATE"],
    ...rows.map((row) => [`observation / ${String(row.jobId)}`, "OBSERVATION"] as const),
    ["plan", "PLAN"],
    ["record", "RECORD"],
  ]);
}

export async function readGithubHostedJobs(input: {
  readonly context: HostedPlanContext;
  readonly fetcher?: GithubFetch;
  readonly registry: unknown;
  readonly token: string;
}): Promise<
  HostedRecordApiResult<{
    readonly jobs: readonly GithubHostedJobEvidence[];
    readonly recordedAt: string;
  }>
> {
  try {
    const registry = parseConformanceRequiredJobRegistry(input.registry);
    if (!registry.ok) return refusal(...registry.issues.map((issue) => `registry.${issue}`));
    const fetcher = input.fetcher ?? fetch;
    const expected = expectedJobNames(registry.value);
    const found = new Map<string, GithubHostedJobEvidence>();
    let totalCount: number | undefined;
    let finalDate: string | undefined;
    for (let page = 1; page <= 4; page += 1) {
      const response = await githubRequest(
        `https://api.github.com/repos/${input.context.repository}/actions/runs/${input.context.runId}/attempts/${input.context.runAttempt}/jobs?per_page=100&page=${page}`,
        input.token,
        fetcher,
      );
      finalDate = canonicalGithubDateHeader(response.headers.get("date"));
      if (!finalDate) return refusal("jobs:date-header-refused");
      const body = dataRecord(await response.json());
      if (!body) return refusal("jobs:response-record-refused");
      const count = dataValue(body, "total_count");
      const jobs = dataValue(body, "jobs");
      if (!Number.isSafeInteger(count) || (count as number) < 1 || (count as number) > 259)
        return refusal("jobs:total-count-refused");
      if (totalCount === undefined) totalCount = count as number;
      else if (totalCount !== count) return refusal("jobs:total-count-moved");
      if (!Array.isArray(jobs) || jobs.length > 100) return refusal("jobs:page-refused");
      for (const rowInput of jobs) {
        const row = dataRecord(rowInput);
        if (!row) return refusal("jobs:row-refused");
        const id = safePositiveDecimal(dataValue(row, "id"));
        const runId = safePositiveDecimal(dataValue(row, "run_id"));
        const runAttempt = safePositiveDecimal(dataValue(row, "run_attempt"));
        const name = dataValue(row, "name");
        const workflowName = dataValue(row, "workflow_name");
        const headSha = dataValue(row, "head_sha");
        const status = dataValue(row, "status");
        const conclusion = dataValue(row, "conclusion");
        if (
          !id ||
          runId !== input.context.runId ||
          runAttempt !== input.context.runAttempt ||
          typeof name !== "string" ||
          !expected.has(name) ||
          workflowName !== "Conformance" ||
          headSha !== input.context.workflowRevision ||
          found.has(name)
        )
          return refusal("jobs:identity-or-census-refused");
        if (name === "record") {
          if (status !== "in_progress" || conclusion !== null)
            return refusal("jobs:record-state-refused");
          found.set(
            name,
            Object.freeze({
              conclusion: "SUCCESS",
              providerJobId: id,
              providerJobName: "Conformance / record",
            }),
          );
        } else {
          if (status !== "completed" || conclusion !== "success")
            return refusal("jobs:required-job-not-successful");
          found.set(
            name,
            Object.freeze({
              conclusion: "SUCCESS",
              providerJobId: id,
              providerJobName: `Conformance / ${name}`,
            }),
          );
        }
      }
      if (jobs.length < 100) break;
      if (page === 4) return refusal("jobs:pagination-over-bound");
    }
    if (!finalDate || totalCount !== found.size || found.size !== expected.size)
      return refusal("jobs:terminal-census-mismatch");
    found.delete("record");
    return {
      ok: true,
      value: Object.freeze({ jobs: Object.freeze([...found.values()]), recordedAt: finalDate }),
    };
  } catch {
    return refusal("jobs:unreadable");
  }
}

function expectedArtifactNames(context: HostedPlanContext, registry: ContractRecord): Set<string> {
  const prefix = `conformance-${context.runId}-${context.runAttempt}-`;
  return new Set([
    `${prefix}aggregate`,
    ...(registry.jobs as readonly ContractRecord[]).map((row) => `${prefix}${String(row.jobId)}`),
  ]);
}

export async function readGithubHostedArtifacts(input: {
  readonly context: HostedPlanContext;
  readonly fetcher?: GithubFetch;
  readonly registry: unknown;
  readonly token: string;
}): Promise<HostedRecordApiResult<readonly GithubHostedArtifactEvidence[]>> {
  try {
    const registry = parseConformanceRequiredJobRegistry(input.registry);
    if (!registry.ok) return refusal(...registry.issues.map((issue) => `registry.${issue}`));
    const fetcher = input.fetcher ?? fetch;
    const expected = expectedArtifactNames(input.context, registry.value);
    const currentAttemptPrefix = `conformance-${input.context.runId}-${input.context.runAttempt}-`;
    const found = new Map<
      string,
      Omit<GithubHostedArtifactEvidence, "archiveBytes"> & { readonly downloadUrl: string }
    >();
    let totalCount: number | undefined;
    let collectedCount = 0;
    for (let page = 1; page <= 1024; page += 1) {
      const response = await githubRequest(
        `https://api.github.com/repos/${input.context.repository}/actions/runs/${input.context.runId}/artifacts?per_page=100&page=${page}`,
        input.token,
        fetcher,
      );
      const body = dataRecord(await response.json());
      if (!body) return refusal("artifacts:response-record-refused");
      const count = dataValue(body, "total_count");
      const artifacts = dataValue(body, "artifacts");
      if (!Number.isSafeInteger(count) || (count as number) < 1 || (count as number) > 4096)
        return refusal("artifacts:total-count-refused");
      if (totalCount === undefined) totalCount = count as number;
      else if (totalCount !== count) return refusal("artifacts:total-count-moved");
      if (!Array.isArray(artifacts) || artifacts.length > 100)
        return refusal("artifacts:page-refused");
      collectedCount += artifacts.length;
      for (const rowInput of artifacts) {
        const row = dataRecord(rowInput);
        if (!row) return refusal("artifacts:row-refused");
        const name = dataValue(row, "name");
        if (typeof name !== "string") return refusal("artifacts:name-refused");
        if (!expected.has(name)) {
          if (name.startsWith(currentAttemptPrefix))
            return refusal("artifacts:current-attempt-extra");
          continue;
        }
        const id = safePositiveDecimal(dataValue(row, "id"));
        const size = safePositiveDecimal(dataValue(row, "size_in_bytes"));
        const digest = dataValue(row, "digest");
        const digestMatch = typeof digest === "string" ? digest.match(digestPattern) : null;
        const expiresAt = canonicalTimestamp(dataValue(row, "expires_at"));
        const downloadUrl = dataValue(row, "archive_download_url");
        const workflowRun = dataRecord(dataValue(row, "workflow_run"));
        if (
          !id ||
          !size ||
          !digestMatch ||
          !expiresAt ||
          typeof downloadUrl !== "string" ||
          downloadUrl !==
            `https://api.github.com/repos/${input.context.repository}/actions/artifacts/${id}/zip` ||
          dataValue(row, "expired") !== false ||
          !workflowRun ||
          safePositiveDecimal(dataValue(workflowRun, "id")) !== input.context.runId ||
          safePositiveDecimal(dataValue(workflowRun, "repository_id")) !==
            input.context.repositoryId ||
          dataValue(workflowRun, "head_sha") !== input.context.workflowRevision ||
          found.has(name)
        )
          return refusal("artifacts:identity-or-census-refused");
        found.set(
          name,
          Object.freeze({
            artifactDigest: digestMatch[1]!,
            artifactId: id,
            artifactName: name,
            byteLength: size,
            downloadUrl,
            expiresAt,
          }),
        );
      }
      if (artifacts.length < 100) break;
      if (page === 1024) return refusal("artifacts:pagination-over-bound");
    }
    if (totalCount !== collectedCount || found.size !== expected.size)
      return refusal("artifacts:terminal-census-mismatch");
    const evidence: GithubHostedArtifactEvidence[] = [];
    for (const row of found.values()) {
      const response = await githubRequest(row.downloadUrl, input.token, fetcher);
      const bytes = new Uint8Array(await response.arrayBuffer());
      evidence.push(
        Object.freeze({
          archiveBytes: bytes,
          artifactDigest: row.artifactDigest,
          artifactId: row.artifactId,
          artifactName: row.artifactName,
          byteLength: row.byteLength,
          expiresAt: row.expiresAt,
        }),
      );
    }
    return { ok: true, value: Object.freeze(evidence) };
  } catch {
    return refusal("artifacts:unreadable");
  }
}

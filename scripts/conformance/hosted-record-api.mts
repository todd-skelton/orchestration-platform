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
  readonly conclusion:
    | "ACTION_REQUIRED"
    | "CANCELLED"
    | "FAILURE"
    | "NEUTRAL"
    | "SKIPPED"
    | "STALE"
    | "STARTUP_FAILURE"
    | "SUCCESS"
    | "TIMED_OUT";
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

function expectedJobNames(
  registry: ContractRecord,
): ReadonlyMap<string, Readonly<{ logicalJobId: string; role: string }>> {
  const rows = registry.jobs as readonly ContractRecord[];
  return new Map([
    ["aggregate", { logicalJobId: "aggregate", role: "AGGREGATE" }],
    ...rows.map(
      (row) =>
        [
          `observation / ${String(row.jobId)}`,
          { logicalJobId: String(row.jobId), role: "OBSERVATION" },
        ] as const,
    ),
    ["plan", { logicalJobId: "plan", role: "PLAN" }],
    ["record", { logicalJobId: "record", role: "RECORD" }],
  ]);
}

const terminalConclusions = new Set([
  "ACTION_REQUIRED",
  "CANCELLED",
  "FAILURE",
  "NEUTRAL",
  "SKIPPED",
  "STALE",
  "STARTUP_FAILURE",
  "SUCCESS",
  "TIMED_OUT",
] as const);

export async function readGithubHostedJobCensus(input: {
  readonly context: HostedPlanContext;
  readonly fetcher?: GithubFetch;
  readonly registry: unknown;
  readonly token: string;
}): Promise<
  HostedRecordApiResult<{
    readonly jobs: readonly GithubHostedJobEvidence[];
    readonly missingLogicalJobIds: readonly string[];
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
          const normalizedConclusion =
            typeof conclusion === "string" ? conclusion.toUpperCase() : "";
          if (
            status !== "completed" ||
            !terminalConclusions.has(
              normalizedConclusion as typeof terminalConclusions extends Set<infer T> ? T : never,
            )
          )
            return refusal("jobs:required-job-not-terminal");
          found.set(
            name,
            Object.freeze({
              conclusion: normalizedConclusion as GithubHostedJobEvidence["conclusion"],
              providerJobId: id,
              providerJobName: `Conformance / ${name}`,
            }),
          );
        }
      }
      if (jobs.length < 100) break;
      if (page === 4) return refusal("jobs:pagination-over-bound");
    }
    if (!finalDate || totalCount !== found.size || !found.has("record"))
      return refusal("jobs:terminal-census-mismatch");
    found.delete("record");
    const missingLogicalJobIds = [...expected.entries()]
      .filter(([name]) => name !== "record" && !found.has(name))
      .map(([, value]) => value.logicalJobId)
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    return {
      ok: true,
      value: Object.freeze({
        jobs: Object.freeze([...found.values()]),
        missingLogicalJobIds: Object.freeze(missingLogicalJobIds),
        recordedAt: finalDate,
      }),
    };
  } catch {
    return refusal("jobs:unreadable");
  }
}

export async function readGithubHostedJobs(
  input: Parameters<typeof readGithubHostedJobCensus>[0],
): Promise<
  HostedRecordApiResult<{
    readonly jobs: readonly GithubHostedJobEvidence[];
    readonly recordedAt: string;
  }>
> {
  const result = await readGithubHostedJobCensus(input);
  if (!result.ok) return result;
  if (
    result.value.missingLogicalJobIds.length !== 0 ||
    result.value.jobs.some((job) => job.conclusion !== "SUCCESS")
  )
    return refusal("jobs:required-job-not-successful");
  return {
    ok: true,
    value: Object.freeze({ jobs: result.value.jobs, recordedAt: result.value.recordedAt }),
  };
}

function expectedArtifactNames(context: HostedPlanContext, registry: ContractRecord): Set<string> {
  const prefix = `conformance-${context.runId}-${context.runAttempt}-`;
  return new Set([
    `${prefix}aggregate`,
    ...(registry.jobs as readonly ContractRecord[]).map((row) => `${prefix}${String(row.jobId)}`),
  ]);
}

export async function readGithubHostedArtifactCensus(input: {
  readonly context: HostedPlanContext;
  readonly fetcher?: GithubFetch;
  readonly registry: unknown;
  readonly token: string;
}): Promise<
  HostedRecordApiResult<{
    readonly artifacts: readonly GithubHostedArtifactEvidence[];
    readonly missingArtifactNames: readonly string[];
  }>
> {
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
      if (!Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > 4096)
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
    if (totalCount !== collectedCount) return refusal("artifacts:terminal-census-mismatch");
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
    const missingArtifactNames = [...expected]
      .filter((name) => !found.has(name))
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    return {
      ok: true,
      value: Object.freeze({
        artifacts: Object.freeze(evidence),
        missingArtifactNames: Object.freeze(missingArtifactNames),
      }),
    };
  } catch {
    return refusal("artifacts:unreadable");
  }
}

export async function readGithubHostedArtifacts(
  input: Parameters<typeof readGithubHostedArtifactCensus>[0],
): Promise<HostedRecordApiResult<readonly GithubHostedArtifactEvidence[]>> {
  const result = await readGithubHostedArtifactCensus(input);
  if (!result.ok) return result;
  if (result.value.missingArtifactNames.length !== 0)
    return refusal("artifacts:terminal-census-mismatch");
  return { ok: true, value: result.value.artifacts };
}

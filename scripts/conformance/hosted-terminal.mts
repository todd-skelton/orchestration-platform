import { execFile } from "node:child_process";
import type { BigIntStats } from "node:fs";
import { link, lstat, open, readFile, readdir, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify, types as nodeTypes } from "node:util";
import { canonicalJson, type ContractRecord } from "../../packages/contracts/src/index.js";
import {
  parseGithubConformanceProviderRecord,
  parseGithubConformanceDiagnosticProviderRecord,
  computeGithubConformanceDiagnosticProviderRecordDigest,
  computeGithubConformanceProviderRecordDigest,
  computeGithubProviderRunDigest,
  projectGithubProtectionSnapshot,
  verifyGithubAggregateArchive,
  verifyGithubArtifactIdentity,
  verifyGithubObservationArchive,
  verifyGithubTerminalEvidence,
  verifyGithubDiagnosticTerminalEvidence,
  type GithubDiagnosticTerminalVerificationResult,
  type GithubProtectionApiInput,
  type GithubTerminalVerificationResult,
} from "../../packages/conformance/src/github-actions/index.js";
import { composePortablePrimitivesDecisionCore } from "../../packages/conformance/src/portable-primitives-decision-writer.js";
import { githubProtectionApi } from "./hosted-plan.mjs";
import { loadHostedStableInputs } from "./hosted-observation.mjs";
import { canonicalGithubDateHeader, type GithubFetch } from "./hosted-record-api.mjs";

const execFileAsync = promisify(execFile);
const revisionPattern = /^[0-9a-f]{40}$/;
const digestPattern = /^sha256:([0-9a-f]{64})$/;
const githubJobStatuses = Object.freeze([
  "completed",
  "in_progress",
  "pending",
  "queued",
  "requested",
  "waiting",
] as const);
const githubJobConclusions = Object.freeze([
  "action_required",
  "cancelled",
  "failure",
  "neutral",
  "skipped",
  "stale",
  "startup_failure",
  "success",
  "timed_out",
] as const);

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

type HostedTerminalVerificationResult =
  GithubTerminalVerificationResult | GithubDiagnosticTerminalVerificationResult;

const githubTerminalRuntime: HostedTerminalRuntime = Object.freeze({
  fetcher: fetch,
  projectProtection: githubProtectionApi.projectProtection,
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
    createdAt: canonicalTimestamp(dataValue(row, "created_at")),
    event: dataValue(row, "event"),
    repositoryId: repositoryRecord && positiveDecimal(dataValue(repositoryRecord, "id")),
    runAttempt: positiveDecimal(dataValue(row, "run_attempt")),
    runId: positiveDecimal(dataValue(row, "id")),
    runStartedAt: canonicalTimestamp(dataValue(row, "run_started_at")),
    status: String(dataValue(row, "status")).toUpperCase(),
    updatedAt: canonicalTimestamp(dataValue(row, "updated_at")),
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
      const status = dataValue(row, "status");
      const conclusion = dataValue(row, "conclusion");
      if (
        dataValue(row, "workflow_name") !== "Conformance" ||
        dataValue(row, "head_sha") !== expected.workflowRevision ||
        positiveDecimal(dataValue(row, "run_id")) !== expected.runId ||
        positiveDecimal(dataValue(row, "run_attempt")) !== expected.runAttempt ||
        typeof name !== "string" ||
        typeof status !== "string" ||
        !(githubJobStatuses as readonly string[]).includes(status) ||
        !(
          conclusion === null ||
          (typeof conclusion === "string" &&
            (githubJobConclusions as readonly string[]).includes(conclusion))
        )
      )
        throw new TypeError("provider:job-association-refused");
      rows.push(
        Object.freeze({
          completedAt: canonicalTimestamp(dataValue(row, "completed_at")),
          conclusion: conclusion === null ? null : conclusion.toUpperCase(),
          providerJobId: positiveDecimal(dataValue(row, "id")),
          providerJobName: `Conformance / ${name}`,
          startedAt: canonicalTimestamp(dataValue(row, "started_at")),
          status: status.toUpperCase(),
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
  readonly diagnosticProviderRecordBytes?: Uint8Array;
  readonly providerRecordBytes: Uint8Array;
}> {
  const prefix = `conformance-${expected.runId}-${expected.runAttempt}-`;
  const rows: ContractRecord[] = [];
  const downloads: Array<Readonly<{ artifactId: string; bytes: Uint8Array }>> = [];
  let providerRecordBytes: Uint8Array | undefined;
  let diagnosticProviderRecordBytes: Uint8Array | undefined;
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
      } else if (name === `${prefix}diagnostic-provider-record.json`) {
        if (diagnosticProviderRecordBytes)
          throw new TypeError("provider:diagnostic-record-artifact-duplicate");
        diagnosticProviderRecordBytes = bytes;
      }
    }
    if (pageRows.length < 100) break;
  }
  if (
    collected !== total ||
    (providerRecordBytes === undefined) === (diagnosticProviderRecordBytes === undefined)
  )
    throw new TypeError("provider:artifacts-terminal-census-refused");
  return Object.freeze({
    artifacts: Object.freeze(rows),
    bytes: Object.freeze(downloads),
    ...(diagnosticProviderRecordBytes ? { diagnosticProviderRecordBytes } : {}),
    providerRecordBytes: providerRecordBytes ?? diagnosticProviderRecordBytes!,
  });
}

function providerRunFromRecord(record: ContractRecord): ContractRecord {
  return Object.freeze({
    candidateRevision: record.candidateRevision,
    candidateSubjectDigest: record.candidateSubjectDigest,
    event: record.event,
    harnessBundleDigest: record.harnessBundleDigest,
    protectedRefDigest: record.protectedRefDigest,
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
): Promise<HostedTerminalVerificationResult> {
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
    const stable = await loadHostedStableInputs(stableRoot);
    if (!stable) return refusal("stable:inputs-refused");
    const repository = await repositoryName(expected, token, runtime);
    const [run, jobs, artifacts, protection] = await Promise.all([
      readGithubTerminalRun(repository, expected, token, runtime),
      readGithubTerminalJobs(repository, expected, token, runtime),
      readGithubTerminalArtifacts(repository, expected, token, runtime),
      runtime.projectProtection(repository, token),
    ]);
    const projectedProtection = projectGithubProtectionSnapshot(protection);
    if (!projectedProtection.ok) return refusal(...projectedProtection.issues);
    if (run.conclusion === "FAILURE") {
      if (!artifacts.diagnosticProviderRecordBytes)
        return refusal("diagnosticProviderRecord:missing");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        artifacts.diagnosticProviderRecordBytes,
      );
      const parsedRecord = parseGithubConformanceDiagnosticProviderRecord(JSON.parse(text));
      if (!parsedRecord.ok) return refusal(...parsedRecord.issues);
      const verifiedAt = await readGithubTerminalVerifiedAt(repository, expected, token, runtime);
      return verifyGithubDiagnosticTerminalEvidence({
        artifactBytes: artifacts.bytes,
        contractVersionsDigest: stable.contractVersionsDigest,
        currentProtectionSnapshot: projectedProtection.value,
        expected,
        liveArtifacts: artifacts.artifacts,
        liveJobs: jobs,
        liveRun: run,
        providerRecordBytes: artifacts.diagnosticProviderRecordBytes,
        providerRun: providerRunFromRecord(parsedRecord.value),
        registry: stable.registry,
        verifiedAt,
      });
    }
    if (!artifacts.providerRecordBytes) return refusal("providerRecord:missing");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(artifacts.providerRecordBytes);
    const parsedRecord = parseGithubConformanceProviderRecord(JSON.parse(text));
    if (!parsedRecord.ok) return refusal(...parsedRecord.issues);
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

export async function readGithubTerminalVerifiedAt(
  repository: string,
  expected: HostedTerminalExpected,
  token: string,
  runtime: HostedTerminalRuntime,
): Promise<string> {
  const response = await request(
    `https://api.github.com/repos/${repository}/actions/runs/${expected.runId}`,
    token,
    runtime,
  );
  const verifiedAt = canonicalGithubDateHeader(response.headers.get("date"));
  const row = dataRecord(await response.json());
  const createdAt = row && canonicalTimestamp(dataValue(row, "created_at"));
  const runStartedAt = row && canonicalTimestamp(dataValue(row, "run_started_at"));
  const updatedAt = row && canonicalTimestamp(dataValue(row, "updated_at"));
  const verifiedAtMilliseconds =
    verifiedAt === undefined ? undefined : new Date(verifiedAt).valueOf();
  if (
    !verifiedAt ||
    !row ||
    positiveDecimal(dataValue(row, "id")) !== expected.runId ||
    positiveDecimal(dataValue(row, "run_attempt")) !== expected.runAttempt ||
    dataValue(row, "head_sha") !== expected.workflowRevision ||
    dataValue(row, "status") !== "completed" ||
    dataValue(row, "conclusion") !== "failure" ||
    !createdAt ||
    !runStartedAt ||
    !updatedAt ||
    verifiedAtMilliseconds === undefined ||
    !(
      new Date(createdAt).valueOf() <= new Date(runStartedAt).valueOf() &&
      new Date(runStartedAt).valueOf() <= new Date(updatedAt).valueOf() &&
      new Date(updatedAt).valueOf() <= verifiedAtMilliseconds
    )
  )
    throw new TypeError("provider:diagnostic-final-response-refused");
  return verifiedAt;
}

type DecisionCompositionResult = ReturnType<typeof composePortablePrimitivesDecisionCore>;

function terminalFailure(
  ...issues: readonly string[]
): Extract<DecisionCompositionResult, { readonly ok: false }> {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function artifactBytesById(
  artifacts: Awaited<ReturnType<typeof readGithubTerminalArtifacts>>,
): ReadonlyMap<string, Uint8Array> {
  return new Map(artifacts.bytes.map((row) => [row.artifactId, row.bytes]));
}

function providerArtifactBytes(
  artifact: ContractRecord,
  bytesById: ReadonlyMap<string, Uint8Array>,
): Uint8Array | undefined {
  const bytes = bytesById.get(String(artifact.artifactId));
  if (!bytes) return undefined;
  const identity = verifyGithubArtifactIdentity(
    bytes,
    String(artifact.artifactDigest),
    String(artifact.byteLength),
  );
  return identity.ok ? bytes : undefined;
}

export async function composeHostedPortablePrimitivesDecisionCore(
  expected: HostedTerminalExpected,
  token: string,
  stableRoot = process.cwd(),
  runtime: HostedTerminalRuntime = githubTerminalRuntime,
): Promise<DecisionCompositionResult> {
  try {
    const verified = await verifyHostedTerminalFromGithub(expected, token, stableRoot, runtime);
    if (!verified.ok) return terminalFailure(...verified.issues);
    const stable = await loadHostedStableInputs(stableRoot);
    if (!stable) return terminalFailure("stable:inputs-refused");
    const repository = await repositoryName(expected, token, runtime);
    const artifacts = await readGithubTerminalArtifacts(repository, expected, token, runtime);
    const recordBytes = artifacts.providerRecordBytes;
    const recordText = new TextDecoder("utf-8", { fatal: true }).decode(recordBytes);
    const bytesById = artifactBytesById(artifacts);
    const evidence: Array<Readonly<Record<string, unknown>>> = [];
    let aggregate: ContractRecord | null = null;
    let diagnosticTerminal: ContractRecord | null = null;
    let providerRun: ContractRecord;
    let providerArtifacts: readonly ContractRecord[];
    if ("diagnosticTerminalDigest" in verified) {
      const parsed = parseGithubConformanceDiagnosticProviderRecord(JSON.parse(recordText));
      if (!parsed.ok) return terminalFailure(...parsed.issues);
      if (
        computeGithubConformanceDiagnosticProviderRecordDigest(parsed.value) !==
          verified.diagnosticProviderRecordDigest ||
        computeGithubProviderRunDigest(providerRunFromRecord(parsed.value)) !==
          verified.providerRunDigest
      )
        return terminalFailure("diagnosticProviderRecord:verified-identity-mismatch");
      diagnosticTerminal = verified.value;
      providerRun = providerRunFromRecord(parsed.value);
      providerArtifacts = parsed.value.artifacts as readonly ContractRecord[];
    } else {
      const parsed = parseGithubConformanceProviderRecord(JSON.parse(recordText));
      if (!parsed.ok) return terminalFailure(...parsed.issues);
      if (
        computeGithubConformanceProviderRecordDigest(parsed.value) !==
          verified.providerRecordDigest ||
        computeGithubProviderRunDigest(providerRunFromRecord(parsed.value)) !==
          verified.providerRunDigest
      )
        return terminalFailure("providerRecord:verified-identity-mismatch");
      providerRun = providerRunFromRecord(parsed.value);
      providerArtifacts = parsed.value.artifacts as readonly ContractRecord[];
      const aggregateRows = providerArtifacts.filter((row) => row.role === "AGGREGATE");
      if (aggregateRows.length !== 1) return terminalFailure("aggregate:artifact-census-refused");
      const aggregateBytes = providerArtifactBytes(aggregateRows[0]!, bytesById);
      if (!aggregateBytes) return terminalFailure("aggregate:artifact-bytes-missing");
      const parsedAggregate = verifyGithubAggregateArchive(aggregateBytes, stable.registry);
      if (!parsedAggregate.ok)
        return terminalFailure(...parsedAggregate.issues.map((issue) => `aggregate.${issue}`));
      aggregate = parsedAggregate.aggregate;
    }
    if (
      artifacts.bytes.length !== providerArtifacts.length + 1 ||
      providerArtifacts.some((row) => !bytesById.has(String(row.artifactId)))
    )
      return terminalFailure("providerArtifacts:terminal-census-mismatch");
    const jobs = stable.registry.jobs as readonly ContractRecord[];
    for (const job of jobs) {
      const jobId = String(job.jobId);
      const rows = providerArtifacts.filter(
        (row) => row.role === "OBSERVATION" && row.logicalJobId === jobId,
      );
      if (rows.length > 1) return terminalFailure(`evidence.${jobId}:duplicate-artifact`);
      if (rows.length === 0) continue;
      const bytes = providerArtifactBytes(rows[0]!, bytesById);
      if (!bytes) return terminalFailure(`evidence.${jobId}:artifact-bytes-missing`);
      const observation = verifyGithubObservationArchive(bytes);
      if (!observation.ok)
        return terminalFailure(...observation.issues.map((issue) => `evidence.${jobId}.${issue}`));
      evidence.push(
        Object.freeze({
          environment: observation.environment,
          jobId,
          rawArtifactManifest: observation.rawArtifactManifest,
          rawArtifacts: observation.rawArtifacts,
        }),
      );
    }
    return composePortablePrimitivesDecisionCore({
      aggregate,
      contractVersions: stable.contractVersions,
      diagnosticContractVersionsDigest:
        "diagnosticTerminalDigest" in verified ? verified.contractVersionsDigest : null,
      diagnosticTerminal,
      evidence: Object.freeze(evidence),
      harnessManifest: stable.bundles.harnessManifest,
      providerRun,
      registry: stable.registry,
      testBundleManifest: stable.bundles.testBundleManifest,
    });
  } catch {
    return terminalFailure("decisionCoreTerminal:unreadable");
  }
}

function within(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

function sameDirectory(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return (
    sameDirectory(left, right) &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.rdev === right.rdev
  );
}

function absent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function gitCustodyAncestor(root: string): Promise<boolean> {
  let current = root;
  for (let depth = 0; depth < 1024; depth += 1) {
    try {
      await lstat(resolve(current, ".git"), { bigint: true });
      return true;
    } catch (error) {
      if (!absent(error)) return true;
    }
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
  return true;
}

async function decisionOutputCustody(
  outputRootInput: string,
  stableRoot: string,
): Promise<
  | {
      readonly before: BigIntStats;
      readonly root: string;
    }
  | undefined
> {
  if (!isAbsolute(outputRootInput)) return undefined;
  const requested = resolve(outputRootInput);
  const [root, before, worktrees] = await Promise.all([
    realpath(requested),
    lstat(requested, { bigint: true }),
    execFileAsync("git", ["-C", stableRoot, "worktree", "list", "--porcelain"], {
      encoding: "utf8",
      windowsHide: true,
    }),
  ]);
  if (
    relative(resolve(root), requested) !== "" ||
    !before.isDirectory() ||
    before.isSymbolicLink() ||
    (await gitCustodyAncestor(root))
  )
    return undefined;
  const paths = String(worktrees.stdout)
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
  if (paths.length === 0) return undefined;
  for (const path of paths) {
    const checkout = await realpath(path);
    if (within(checkout, root) || within(root, checkout)) return undefined;
  }
  if ((await readdir(root)).length !== 0) return undefined;
  return Object.freeze({ before, root });
}

export interface DecisionOutputCustodyTestHooks {
  readonly afterFinalize?: (root: string, filename: string) => Promise<void>;
  readonly afterPendingWrite?: (root: string, pendingFilename: string) => Promise<void>;
}

type DecisionOutputResult =
  { readonly ok: true } | { readonly issues: readonly string[]; readonly ok: false };

async function exactOutputRoot(
  custody: Readonly<{ readonly before: BigIntStats; readonly root: string }>,
): Promise<boolean> {
  try {
    const [root, stat] = await Promise.all([
      realpath(custody.root),
      lstat(custody.root, { bigint: true }),
    ]);
    return (
      relative(root, custody.root) === "" &&
      stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      sameDirectory(custody.before, stat)
    );
  } catch {
    return false;
  }
}

async function cleanupDecisionOutput(
  custody: Readonly<{ readonly before: BigIntStats; readonly root: string }>,
  pendingPath: string,
  finalPath: string,
  opened: BigIntStats,
): Promise<boolean> {
  try {
    if (!(await exactOutputRoot(custody))) return false;
    const retained: string[] = [];
    for (const path of [pendingPath, finalPath]) {
      try {
        const stat = await lstat(path, { bigint: true });
        if (sameFile(opened, stat) && stat.isFile() && !stat.isSymbolicLink()) retained.push(path);
      } catch (error) {
        if (!absent(error)) return false;
      }
    }
    if (retained.length < 1 || retained.length > 2) return false;
    for (const path of retained) {
      const stat = await lstat(path, { bigint: true });
      if (!sameFile(opened, stat)) return false;
      await unlink(path);
    }
    if (!(await exactOutputRoot(custody))) return false;
    if ((await readdir(custody.root)).length !== 0) return false;
    for (const path of [pendingPath, finalPath]) {
      try {
        await lstat(path, { bigint: true });
        return false;
      } catch (error) {
        if (!absent(error)) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function commitDecisionOutput(
  custody: Readonly<{ readonly before: BigIntStats; readonly root: string }>,
  filename: string,
  bytes: Uint8Array,
  hooks: DecisionOutputCustodyTestHooks = {},
): Promise<DecisionOutputResult> {
  const pendingFilename = `.${filename}.pending`;
  const pendingPath = resolve(custody.root, pendingFilename);
  const finalPath = resolve(custody.root, filename);
  let opened: BigIntStats | undefined;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let created = false;
  try {
    if (!(await exactOutputRoot(custody)) || (await readdir(custody.root)).length !== 0)
      return terminalFailure("decisionOutput:moved-or-populated");
    handle = await open(pendingPath, "wx", 0o600);
    created = true;
    opened = await handle.stat({ bigint: true });
    if (!opened.isFile()) throw new TypeError("decisionOutput:pending-not-file");
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await hooks.afterPendingWrite?.(custody.root, pendingFilename);
    const [pendingStat, pendingBytes, entries] = await Promise.all([
      lstat(pendingPath, { bigint: true }),
      readFile(pendingPath),
      readdir(custody.root),
    ]);
    if (
      !(await exactOutputRoot(custody)) ||
      !sameFile(opened, pendingStat) ||
      !Buffer.from(pendingBytes).equals(Buffer.from(bytes)) ||
      entries.length !== 1 ||
      entries[0] !== pendingFilename
    )
      throw new TypeError("decisionOutput:pending-census-refused");
    await link(pendingPath, finalPath);
    await unlink(pendingPath);
    await hooks.afterFinalize?.(custody.root, filename);
    const [finalStat, finalBytes, finalEntries] = await Promise.all([
      lstat(finalPath, { bigint: true }),
      readFile(finalPath),
      readdir(custody.root),
    ]);
    if (
      !(await exactOutputRoot(custody)) ||
      !sameFile(opened, finalStat) ||
      !Buffer.from(finalBytes).equals(Buffer.from(bytes)) ||
      finalEntries.length !== 1 ||
      finalEntries[0] !== filename
    )
      throw new TypeError("decisionOutput:final-census-refused");
    return { ok: true };
  } catch {
    let closeFailed = false;
    try {
      await handle?.close();
    } catch {
      closeFailed = true;
    }
    if (!created) return terminalFailure("decisionOutput:unreadable");
    if (!opened) return terminalFailure("decisionOutput:cleanup-refused");
    return !closeFailed && (await cleanupDecisionOutput(custody, pendingPath, finalPath, opened))
      ? terminalFailure("decisionOutput:refused")
      : terminalFailure("decisionOutput:cleanup-refused");
  }
}

/** Exercises only the mechanical custody sink with a non-authority filename. */
export async function exerciseDecisionOutputCustodyForTest(
  outputRootInput: string,
  stableRoot: string,
  hooks: DecisionOutputCustodyTestHooks = {},
): Promise<DecisionOutputResult> {
  try {
    const custody = await decisionOutputCustody(outputRootInput, stableRoot);
    if (!custody) return terminalFailure("decisionOutput:refused");
    return commitDecisionOutput(
      custody,
      "custody-mechanics-probe.json",
      new TextEncoder().encode("{}"),
      hooks,
    );
  } catch {
    return terminalFailure("decisionOutput:refused");
  }
}

export async function writeHostedPortablePrimitivesDecisionCore(
  expected: HostedTerminalExpected,
  token: string,
  outputRootInput: string,
  stableRoot = process.cwd(),
  runtime: HostedTerminalRuntime = githubTerminalRuntime,
): Promise<
  | { readonly digest: string; readonly filename: string; readonly ok: true }
  | { readonly issues: readonly string[]; readonly ok: false }
> {
  try {
    const custody = await decisionOutputCustody(outputRootInput, stableRoot);
    if (!custody) return terminalFailure("decisionOutput:refused");
    const composed = await composeHostedPortablePrimitivesDecisionCore(
      expected,
      token,
      stableRoot,
      runtime,
    );
    if (!composed.ok) return composed;
    const filename = `portable-primitives-${expected.runId}-${expected.runAttempt}-decision-core.json`;
    const written = await commitDecisionOutput(custody, filename, composed.bytes);
    if (!written.ok) return written;
    return { digest: composed.digest, filename, ok: true };
  } catch {
    return terminalFailure("decisionOutput:unreadable");
  }
}

export function parseHostedTerminalArguments(
  input: readonly string[],
): { readonly ok: true; readonly value: HostedTerminalExpected } | { readonly ok: false } {
  if (input.length !== 4) return { ok: false };
  const [repositoryId, runId, runAttempt, workflowRevision] = input;
  if (
    !repositoryId ||
    !runId ||
    !runAttempt ||
    !workflowRevision ||
    !expectedDecimal(repositoryId) ||
    !expectedDecimal(runId) ||
    !expectedDecimal(runAttempt) ||
    !revisionPattern.test(workflowRevision)
  )
    return { ok: false };
  return {
    ok: true,
    value: Object.freeze({ repositoryId, runAttempt, runId, workflowRevision }),
  };
}

export async function runHostedTerminalCli(
  arguments_: readonly string[] = process.argv.slice(2),
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  const parsed = parseHostedTerminalArguments(arguments_);
  const token = environment.GITHUB_TOKEN;
  if (!parsed.ok || !token) {
    process.stdout.write(`${canonicalJson({ issues: ["input:refused"], result: "REFUSED" })}\n`);
    return 1;
  }
  const result = await verifyHostedTerminalFromGithub(parsed.value, token);
  if (!result.ok) {
    process.stdout.write(`${canonicalJson({ issues: result.issues, result: "REFUSED" })}\n`);
    return 1;
  }
  if ("diagnosticTerminalDigest" in result) {
    process.stdout.write(
      `${canonicalJson({
        diagnosticProviderRecordDigest: result.diagnosticProviderRecordDigest,
        diagnosticTerminal: result.value,
        diagnosticTerminalDigest: result.diagnosticTerminalDigest,
        providerRunDigest: result.providerRunDigest,
        result: "BLOCK_REPLAN",
      })}\n`,
    );
    return 0;
  }
  process.stdout.write(
    `${canonicalJson({
      providerRecordDigest: result.providerRecordDigest,
      providerRunDigest: result.providerRunDigest,
      result: "PASS",
    })}\n`,
  );
  return 0;
}

export async function runHostedTerminalEntrypoint(
  arguments_: readonly string[] = process.argv.slice(2),
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  if (arguments_[0] !== "portable-primitives-decision")
    return runHostedTerminalCli(arguments_, environment);
  const parsed = parseHostedTerminalArguments(arguments_.slice(1));
  const token = environment.GITHUB_TOKEN;
  const outputRoot = environment.PORTABLE_PRIMITIVES_OUTPUT_ROOT;
  if (!parsed.ok || !token || !outputRoot) {
    process.stdout.write(`${canonicalJson({ issues: ["input:refused"], result: "REFUSED" })}\n`);
    return 1;
  }
  const result = await writeHostedPortablePrimitivesDecisionCore(parsed.value, token, outputRoot);
  if (!result.ok) {
    process.stdout.write(`${canonicalJson({ issues: result.issues, result: "REFUSED" })}\n`);
    return 1;
  }
  process.stdout.write(
    `${canonicalJson({
      decisionCoreDigest: result.digest,
      filename: result.filename,
      result: "WRITTEN",
    })}\n`,
  );
  return 0;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exitCode = await runHostedTerminalEntrypoint();
}

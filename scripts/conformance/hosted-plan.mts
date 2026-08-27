import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify, types as nodeTypes } from "node:util";
import {
  canonicalJson,
  schemaVersions,
  type ContractRecord,
} from "../../packages/contracts/src/index.js";
import {
  computeConformanceRecordDigest,
  createIss002ContractVersions,
  createIss002RequiredJobRegistry,
  createIss002StableBundleManifests,
  createIss002VectorCensus,
  parseConformanceRequiredJobRegistry,
} from "../../packages/conformance/src/index.js";
import {
  computeGithubProviderRunDigest,
  parseGithubConformanceProtectionSnapshot,
  parseGithubProviderRunContext,
  projectGithubCandidateSubject,
  projectGithubProtectionSnapshot,
  type GithubProtectionApiInput,
} from "../../packages/conformance/src/github-actions/index.js";

const execFileAsync = promisify(execFile);
const commitPattern = /^[0-9a-f]{40}$/;
const positiveDecimalPattern = /^[1-9][0-9]*$/;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const selectionFile = ".conformance/plan-selection.json";
const contextFile = ".conformance/plan-context.json";

export type HostedPlanResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly string[] };

export interface HostedDispatchContext {
  readonly candidateRevision: string;
  readonly repository: string;
  readonly repositoryId: string;
  readonly runAttempt: string;
  readonly runId: string;
  readonly workflowPath: ".github/workflows/conformance.yml";
  readonly workflowRef: string;
  readonly workflowRevision: string;
}

export interface HostedPlanSelection extends HostedDispatchContext {
  readonly event: "repository_dispatch";
  readonly protectionSnapshot: ContractRecord;
  readonly protectionSnapshotDigest: string;
  readonly schemaVersion: "hosted-conformance-plan-selection/v1";
}

export interface HostedPlanContext extends HostedDispatchContext {
  readonly candidateSubjectDigest: string;
  readonly contractVersionsDigest: string;
  readonly event: "repository_dispatch";
  readonly harnessBundleDigest: string;
  readonly protectionSnapshotDigest: string;
  readonly providerRunDigest: string;
  readonly requiredJobRegistryDigest: string;
  readonly schemaVersion: "hosted-conformance-plan-context/v1";
  readonly testBundleDigest: string;
  readonly vectorCensusDigest: string;
}

export interface HostedPlanApi {
  readonly projectProtection: (
    repository: string,
    token: string,
  ) => Promise<GithubProtectionApiInput>;
  readonly resolveCommit: (repository: string, revision: string, token: string) => Promise<string>;
}

export interface HostedCandidateSourceFile {
  readonly bytes: Uint8Array;
  readonly executable: boolean;
  readonly path: string;
}

export interface HostedCandidateSnapshot {
  readonly digest: string;
  readonly files: readonly HostedCandidateSourceFile[];
  readonly subject: ContractRecord;
}

function refusal<T>(...issues: readonly string[]): HostedPlanResult<T> {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function plainRecord(input: unknown): Readonly<Record<string, unknown>> | undefined {
  if (
    input === null ||
    typeof input !== "object" ||
    nodeTypes.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const descriptor of Object.values(descriptors))
    if (!("value" in descriptor) || descriptor.enumerable !== true) return undefined;
  return input as Readonly<Record<string, unknown>>;
}

function exactRecord(
  input: unknown,
  fields: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  const record = plainRecord(input);
  if (!record) return undefined;
  const keys = Reflect.ownKeys(Object.getOwnPropertyDescriptors(record));
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join("\0") !== [...fields].sort().join("\0")
  )
    return undefined;
  return record;
}

function safePositiveDecimal(value: unknown): value is string {
  return (
    typeof value === "string" &&
    positiveDecimalPattern.test(value) &&
    Number.isSafeInteger(Number(value))
  );
}

function environmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(environment, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

export function parseHostedDispatchContext(
  environment: Readonly<Record<string, string | undefined>>,
  eventInput: unknown,
): HostedPlanResult<HostedDispatchContext> {
  try {
    const event = plainRecord(eventInput);
    const payload = event && exactRecord(event.client_payload, ["candidateRevision"]);
    const candidateRevision = payload?.candidateRevision;
    const repository = environmentValue(environment, "GITHUB_REPOSITORY");
    const repositoryId = environmentValue(environment, "GITHUB_REPOSITORY_ID");
    const runAttempt = environmentValue(environment, "GITHUB_RUN_ATTEMPT");
    const runId = environmentValue(environment, "GITHUB_RUN_ID");
    const workflowRevision = environmentValue(environment, "GITHUB_WORKFLOW_SHA");
    const githubSha = environmentValue(environment, "GITHUB_SHA");
    const workflowPath = ".github/workflows/conformance.yml" as const;
    const workflowRef = repository ? `${repository}/${workflowPath}@refs/heads/main` : undefined;
    const issues: string[] = [];
    if (!event || event.action !== "conformance_candidate") issues.push("event:action-refused");
    if (!payload || typeof candidateRevision !== "string" || !commitPattern.test(candidateRevision))
      issues.push("event:closed-candidate-payload-refused");
    if (environmentValue(environment, "GITHUB_EVENT_NAME") !== "repository_dispatch")
      issues.push("context:event-refused");
    if (environmentValue(environment, "GITHUB_REF") !== "refs/heads/main")
      issues.push("context:ref-refused");
    if (environmentValue(environment, "GITHUB_REF_PROTECTED") !== "true")
      issues.push("context:unprotected-ref");
    if (!repository || !repositoryPattern.test(repository))
      issues.push("context:repository-refused");
    if (!safePositiveDecimal(repositoryId)) issues.push("context:repository-id-refused");
    if (!safePositiveDecimal(runAttempt)) issues.push("context:run-attempt-refused");
    if (!safePositiveDecimal(runId)) issues.push("context:run-id-refused");
    if (
      !workflowRevision ||
      !commitPattern.test(workflowRevision) ||
      workflowRevision !== githubSha
    )
      issues.push("context:workflow-revision-refused");
    if (environmentValue(environment, "GITHUB_WORKFLOW_REF") !== workflowRef)
      issues.push("context:workflow-ref-refused");
    return issues.length === 0
      ? {
          ok: true,
          value: Object.freeze({
            candidateRevision: candidateRevision as string,
            repository: repository as string,
            repositoryId: repositoryId as string,
            runAttempt: runAttempt as string,
            runId: runId as string,
            workflowPath,
            workflowRef: workflowRef as string,
            workflowRevision: workflowRevision as string,
          }),
        }
      : refusal(...issues);
  } catch {
    return refusal("context:unreadable");
  }
}

export async function selectHostedPlan(
  context: HostedDispatchContext,
  token: string,
  api: HostedPlanApi,
): Promise<HostedPlanResult<HostedPlanSelection>> {
  try {
    if (typeof token !== "string" || token.length === 0) return refusal("provider:token-required");
    const [resolvedRevision, protectionInput] = await Promise.all([
      api.resolveCommit(context.repository, context.candidateRevision, token),
      api.projectProtection(context.repository, token),
    ]);
    if (resolvedRevision !== context.candidateRevision)
      return refusal("candidate:resolved-revision-mismatch");
    const protection = projectGithubProtectionSnapshot(protectionInput);
    if (!protection.ok) return refusal(...protection.issues.map((issue) => `protection.${issue}`));
    return {
      ok: true,
      value: Object.freeze({
        ...context,
        event: "repository_dispatch",
        protectionSnapshot: protection.value,
        protectionSnapshotDigest: protection.digest,
        schemaVersion: "hosted-conformance-plan-selection/v1",
      }),
    };
  } catch {
    return refusal("provider:selection-unreadable");
  }
}

function within(root: string, path: string): boolean {
  const value = relative(root, path);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

export function parseGitTreeOutput(
  output: Uint8Array,
): HostedPlanResult<readonly ContractRecord[]> {
  try {
    if (output.byteLength === 0 || output[output.byteLength - 1] !== 0)
      return refusal("candidate:tree-unterminated");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const rows: ContractRecord[] = [];
    let start = 0;
    for (let index = 0; index < output.byteLength; index += 1) {
      if (output[index] !== 0) continue;
      const rowBytes = output.subarray(start, index);
      start = index + 1;
      const tab = rowBytes.indexOf(9);
      if (tab < 1) return refusal("candidate:tree-row-refused");
      const header = decoder.decode(rowBytes.subarray(0, tab));
      const path = decoder.decode(rowBytes.subarray(tab + 1));
      const match = header.match(/^([0-9]{6}) (blob|commit) ([0-9a-f]{40})$/);
      if (!match) return refusal("candidate:tree-header-refused");
      rows.push(
        Object.freeze({
          mode: match[1]!,
          objectId: match[3]!,
          path,
          type: match[2]!,
        }),
      );
    }
    return rows.length > 0
      ? { ok: true, value: Object.freeze(rows) }
      : refusal("candidate:tree-empty");
  } catch {
    return refusal("candidate:tree-unreadable");
  }
}

function gitBlobObjectId(bytes: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`, "utf8")
    .update(bytes)
    .digest("hex");
}

async function candidateProjectionFromTree(
  candidateRoot: string,
  treeRows: readonly ContractRecord[],
): Promise<HostedPlanResult<HostedCandidateSnapshot>> {
  try {
    const root = resolve(candidateRoot);
    const objectIds: string[] = [];
    for (const row of treeRows) {
      if (typeof row.objectId !== "string" || !commitPattern.test(row.objectId))
        return refusal("candidate:tree-object-id-refused");
      objectIds.push(row.objectId);
    }
    const blobBytes = await gitBlobBatch(root, objectIds);
    const entries: Array<
      Readonly<{ bytes: Uint8Array; mode: string; path: string; type: string }>
    > = [];
    for (let index = 0; index < treeRows.length; index += 1) {
      const row = treeRows[index]!;
      const mode = row.mode;
      const objectId = row.objectId;
      const path = row.path;
      const type = row.type;
      const bytes = blobBytes[index]!;
      if (
        typeof mode !== "string" ||
        typeof objectId !== "string" ||
        typeof path !== "string" ||
        typeof type !== "string"
      )
        return refusal("candidate:tree-row-type-refused");
      if (gitBlobObjectId(bytes) !== objectId) return refusal("candidate:checkout-blob-mismatch");
      entries.push(Object.freeze({ bytes, mode, path, type }));
    }
    const projection = projectGithubCandidateSubject({
      entries: Object.freeze(entries),
      truncated: false,
    });
    return projection.ok
      ? {
          ok: true,
          value: Object.freeze({
            digest: projection.digest,
            files: Object.freeze(
              entries.map((entry) =>
                Object.freeze({
                  bytes: Uint8Array.from(entry.bytes),
                  executable: entry.mode === "100755",
                  path: entry.path,
                }),
              ),
            ),
            subject: projection.value,
          }),
        }
      : refusal(...projection.issues.map((issue) => `candidate.${issue}`));
  } catch {
    return refusal("candidate:checkout-unreadable");
  }
}

async function gitBlobBatch(
  candidateRoot: string,
  objectIds: readonly string[],
): Promise<Uint8Array[]> {
  if (objectIds.length === 0 || objectIds.length > 65_536)
    throw new TypeError("candidate:blob-batch-census-refused");
  const child = spawn("git", ["-C", candidateRoot, "cat-file", "--batch"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let stdoutLength = 0;
  let stderrLength = 0;
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutLength += chunk.byteLength;
    if (stdoutLength > 256 * 1024 * 1024) child.kill();
    else stdout.push(Buffer.from(chunk));
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrLength += chunk.byteLength;
    if (stderrLength > 1024 * 1024) child.kill();
    else stderr.push(Buffer.from(chunk));
  });
  const completed = new Promise<void>((accept, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0 && stderrLength === 0) accept();
      else reject(new Error("candidate:blob-batch-refused"));
    });
  });
  child.stdin.end(`${objectIds.join("\n")}\n`, "utf8");
  await completed;
  const output = Buffer.concat(stdout, stdoutLength);
  const values: Uint8Array[] = [];
  let offset = 0;
  for (const objectId of objectIds) {
    const headerEnd = output.indexOf(10, offset);
    if (headerEnd < 0) throw new TypeError("candidate:blob-header-unterminated");
    const header = output.subarray(offset, headerEnd).toString("ascii");
    const match = header.match(/^([0-9a-f]{40}) blob ([0-9]+)$/);
    if (!match || match[1] !== objectId) throw new TypeError("candidate:blob-header-refused");
    const length = Number(match[2]);
    if (!Number.isSafeInteger(length) || length < 0)
      throw new TypeError("candidate:blob-length-refused");
    const start = headerEnd + 1;
    const end = start + length;
    if (end >= output.byteLength || output[end] !== 10)
      throw new TypeError("candidate:blob-body-refused");
    values.push(Uint8Array.from(output.subarray(start, end)));
    offset = end + 1;
  }
  if (offset !== output.byteLength) throw new TypeError("candidate:blob-output-extra-bytes");
  return values;
}

function registryMatrix(
  registryInput: unknown,
): HostedPlanResult<Readonly<{ include: readonly ContractRecord[] }>> {
  const parsed = parseConformanceRequiredJobRegistry(registryInput);
  if (!parsed.ok) return refusal(...parsed.issues.map((issue) => `registry.${issue}`));
  const registry = parsed.value;
  const jobs = registry.jobs as readonly ContractRecord[];
  const suites = registry.suites as readonly ContractRecord[];
  const suiteById = new Map(suites.map((suite) => [String(suite.suiteId), suite]));
  const runnerByFamily = new Map([
    ["LINUX", "ubuntu-latest"],
    ["MACOS", "macos-latest"],
    ["WINDOWS", "windows-latest"],
  ]);
  const include: ContractRecord[] = [];
  for (const job of jobs) {
    const suite = suiteById.get(String(job.suiteId));
    const runner = runnerByFamily.get(String(job.environmentFamily));
    if (!suite || !runner) return refusal("registry:matrix-row-refused");
    include.push(
      Object.freeze({
        jobId: String(job.jobId),
        runner,
        runnerToken: String(suite.runnerToken),
        suiteId: String(job.suiteId),
      }),
    );
  }
  return { ok: true, value: Object.freeze({ include: Object.freeze(include) }) };
}

async function gitOutput(
  candidateRoot: string,
  arguments_: readonly string[],
): Promise<Uint8Array> {
  const result = (await execFileAsync("git", ["-C", candidateRoot, ...arguments_], {
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  })) as unknown as { stdout: Buffer };
  return Uint8Array.from(result.stdout);
}

export async function loadHostedCandidateSnapshot(
  candidateRootInput: string,
  candidateRevision: string,
): Promise<HostedPlanResult<HostedCandidateSnapshot>> {
  try {
    if (!isAbsolute(candidateRootInput) || !commitPattern.test(candidateRevision))
      return refusal("candidate:snapshot-input-refused");
    const candidateRoot = resolve(candidateRootInput);
    const [headBytes, statusBytes, treeBytes] = await Promise.all([
      gitOutput(candidateRoot, ["rev-parse", "HEAD"]),
      gitOutput(candidateRoot, ["status", "--porcelain=v1", "--untracked-files=all"]),
      gitOutput(candidateRoot, ["ls-tree", "-r", "-z", "--full-tree", candidateRevision]),
    ]);
    const head = new TextDecoder("utf-8", { fatal: true }).decode(headBytes).trim();
    if (head !== candidateRevision) return refusal("candidate:checkout-revision-mismatch");
    if (statusBytes.byteLength !== 0) return refusal("candidate:checkout-not-clean");
    const tree = parseGitTreeOutput(treeBytes);
    if (!tree.ok) return tree;
    return await candidateProjectionFromTree(candidateRoot, tree.value);
  } catch {
    return refusal("candidate:snapshot-unreadable");
  }
}

export async function finalizeHostedPlan(input: {
  readonly candidateRoot: string;
  readonly selection: HostedPlanSelection;
  readonly stableRoot: string;
}): Promise<
  HostedPlanResult<{
    readonly context: HostedPlanContext;
    readonly encodedContext: string;
    readonly matrix: Readonly<{ include: readonly ContractRecord[] }>;
  }>
> {
  try {
    const stableRoot = resolve(input.stableRoot);
    const candidateRoot = resolve(input.candidateRoot);
    if (
      !isAbsolute(input.candidateRoot) ||
      within(stableRoot, candidateRoot) ||
      within(candidateRoot, stableRoot)
    )
      return refusal("candidate:separate-root-required");
    const [candidate, bundles] = await Promise.all([
      loadHostedCandidateSnapshot(candidateRoot, input.selection.candidateRevision),
      createIss002StableBundleManifests(stableRoot),
    ]);
    if (!candidate.ok) return candidate;
    if (!bundles.ok) return refusal(...bundles.issues);
    const generatorBytes = Uint8Array.from(
      await readFile(resolve(stableRoot, "packages/conformance/src/iss002-vector-generator.mjs")),
    );
    const vectorCensus = createIss002VectorCensus(generatorBytes);
    const contractVersions = createIss002ContractVersions(schemaVersions);
    const registry = createIss002RequiredJobRegistry(vectorCensus);
    const matrix = registryMatrix(registry);
    if (!matrix.ok) return matrix;
    const harnessBundleDigest = computeConformanceRecordDigest(
      "conformance-bundle-manifest/v1",
      bundles.harnessManifest,
    );
    const testBundleDigest = computeConformanceRecordDigest(
      "conformance-bundle-manifest/v1",
      bundles.testBundleManifest,
    );
    const vectorCensusDigest = computeConformanceRecordDigest(
      "conformance-vector-census/v1",
      vectorCensus,
    );
    const contractVersionsDigest = computeConformanceRecordDigest(
      "conformance-contract-versions/v1",
      contractVersions,
    );
    const requiredJobRegistryDigest = computeConformanceRecordDigest(
      "conformance-required-job-registry/v1",
      registry,
    );
    const providerRunContext = Object.freeze({
      candidateRevision: input.selection.candidateRevision,
      candidateSubjectDigest: candidate.value.digest,
      event: "repository_dispatch",
      harnessBundleDigest,
      protectionSnapshotDigest: input.selection.protectionSnapshotDigest,
      repositoryId: input.selection.repositoryId,
      requiredJobRegistryDigest,
      runAttempt: input.selection.runAttempt,
      runId: input.selection.runId,
      testBundleDigest,
      workflowPath: input.selection.workflowPath,
      workflowRef: input.selection.workflowRef,
      workflowRevision: input.selection.workflowRevision,
    });
    const parsedProviderRun = parseGithubProviderRunContext(providerRunContext);
    if (!parsedProviderRun.ok) return refusal(...parsedProviderRun.issues);
    const context: HostedPlanContext = Object.freeze({
      candidateRevision: input.selection.candidateRevision,
      candidateSubjectDigest: candidate.value.digest,
      contractVersionsDigest,
      event: "repository_dispatch",
      harnessBundleDigest,
      protectionSnapshotDigest: input.selection.protectionSnapshotDigest,
      providerRunDigest: computeGithubProviderRunDigest(parsedProviderRun.value),
      repository: input.selection.repository,
      repositoryId: input.selection.repositoryId,
      requiredJobRegistryDigest,
      runAttempt: input.selection.runAttempt,
      runId: input.selection.runId,
      schemaVersion: "hosted-conformance-plan-context/v1",
      testBundleDigest,
      vectorCensusDigest,
      workflowPath: input.selection.workflowPath,
      workflowRef: input.selection.workflowRef,
      workflowRevision: input.selection.workflowRevision,
    });
    const encodedContext = Buffer.from(canonicalJson(context), "utf8").toString("base64url");
    if (encodedContext.length > 64 * 1024) return refusal("plan:context-output-over-bound");
    return { ok: true, value: Object.freeze({ context, encodedContext, matrix: matrix.value }) };
  } catch {
    return refusal("plan:finalize-refused");
  }
}

async function githubJson(url: string, token: string): Promise<Response> {
  return fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

function nextLink(value: string | null): string | undefined {
  if (!value) return undefined;
  for (const row of value.split(",")) {
    const match = row.trim().match(/^<([^>]+)>; rel="([^"]+)"$/);
    if (match?.[2] === "next") return match[1];
  }
  return undefined;
}

export const githubPlanApi: HostedPlanApi = Object.freeze({
  async resolveCommit(repository: string, revision: string, token: string) {
    const response = await githubJson(
      `https://api.github.com/repos/${repository}/commits/${revision}`,
      token,
    );
    if (!response.ok) throw new Error("provider:commit-unreadable");
    const body = plainRecord(await response.json());
    if (!body || typeof body.sha !== "string" || !commitPattern.test(body.sha))
      throw new Error("provider:commit-response-refused");
    return body.sha;
  },
  async projectProtection(repository: string, token: string): Promise<GithubProtectionApiInput> {
    const branchResponse = await githubJson(
      `https://api.github.com/repos/${repository}/branches/main/protection`,
      token,
    );
    const branchProtectionStatus: GithubProtectionApiInput["branchProtectionStatus"] =
      branchResponse.ok ? "FOUND" : branchResponse.status === 404 ? "NOT_FOUND" : "UNREADABLE";
    const branchProtection = branchResponse.ok ? await branchResponse.json() : null;
    const pages: unknown[][] = [];
    let url: string | undefined =
      `https://api.github.com/repos/${repository}/rulesets?includes_parents=true&per_page=100&page=1`;
    for (let page = 0; url && page < 1024; page += 1) {
      const response = await githubJson(url, token);
      if (!response.ok) throw new Error("provider:rulesets-unreadable");
      const body = await response.json();
      if (!Array.isArray(body)) throw new Error("provider:rulesets-page-refused");
      pages.push(body);
      url = nextLink(response.headers.get("link"));
    }
    if (url) throw new Error("provider:rulesets-pagination-over-bound");
    return {
      branchProtection,
      branchProtectionStatus,
      rulesetPages: pages,
      rulesetPaginationTerminal: true,
      targetRef: "refs/heads/main",
    };
  },
});

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function parseSelection(input: unknown): HostedPlanResult<HostedPlanSelection> {
  const fields = [
    "candidateRevision",
    "event",
    "protectionSnapshot",
    "protectionSnapshotDigest",
    "repository",
    "repositoryId",
    "runAttempt",
    "runId",
    "schemaVersion",
    "workflowPath",
    "workflowRef",
    "workflowRevision",
  ];
  const record = exactRecord(input, fields);
  if (!record) return refusal("selection:closed-record-refused");
  const protection = parseGithubConformanceProtectionSnapshot(record.protectionSnapshot);
  if (!protection.ok) return refusal(...protection.issues.map((issue) => `selection.${issue}`));
  const candidateRevision = record.candidateRevision;
  if (
    record.schemaVersion !== "hosted-conformance-plan-selection/v1" ||
    record.event !== "repository_dispatch" ||
    typeof candidateRevision !== "string" ||
    !commitPattern.test(candidateRevision)
  )
    return refusal("selection:scalar-refused");
  return { ok: true, value: record as unknown as HostedPlanSelection };
}

async function writeOutput(name: string, value: string): Promise<void> {
  const output = process.env.GITHUB_OUTPUT;
  if (!output || !isAbsolute(output) || /[\r\n]/.test(name) || /[\r\n]/.test(value))
    throw new Error("provider:output-refused");
  await appendFile(output, `${name}=${value}\n`, "utf8");
}

export async function runHostedPlanSelect(): Promise<void> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !isAbsolute(eventPath)) throw new Error("provider:event-path-refused");
  const context = parseHostedDispatchContext(process.env, await readJsonFile(eventPath));
  if (!context.ok) throw new Error("provider:dispatch-context-refused");
  const selection = await selectHostedPlan(
    context.value,
    process.env.GITHUB_TOKEN ?? "",
    githubPlanApi,
  );
  if (!selection.ok) throw new Error("provider:plan-selection-refused");
  await mkdir(resolve(".conformance"), { recursive: false });
  await writeFile(resolve(selectionFile), canonicalJson(selection.value), {
    encoding: "utf8",
    flag: "wx",
  });
  await writeOutput("candidateRevision", selection.value.candidateRevision);
}

export async function runHostedPlanFinalize(): Promise<void> {
  const selection = parseSelection(await readJsonFile(resolve(selectionFile)));
  const candidateRoot = process.env.CANDIDATE_ROOT;
  if (!selection.ok || !candidateRoot) throw new Error("provider:plan-selection-refused");
  const finalized = await finalizeHostedPlan({
    candidateRoot,
    selection: selection.value,
    stableRoot: process.cwd(),
  });
  if (!finalized.ok) throw new Error("provider:plan-finalize-refused");
  await writeFile(resolve(contextFile), canonicalJson(finalized.value.context), {
    encoding: "utf8",
    flag: "wx",
  });
  await writeOutput("context", finalized.value.encodedContext);
  await writeOutput("matrix", JSON.stringify(finalized.value.matrix));
}

/**
 * Structure-only parsing for the historical `repository-protection-receipt/v1`
 * family (ISS-054 Packet A, Decisions #268/#272, pressure Round 451).
 *
 * This module is package-private: `src/index.ts` and `src/registry.ts` do not
 * re-export it, so the public schema family stays unsupported until Packet B
 * adds the reviewed relations module. Success here proves only that a detached
 * input tree is closed, typed and locally well formed. It makes no
 * cross-record equality, chronology, pagination, projection, digest,
 * authentication, completeness, freshness or authority claim.
 *
 * Every entry point runs two internal stages:
 *
 * 1. Closure/type stage. The root is snapshotted once with the repository
 *    hostile-reflection primitive, then every child record, array and element
 *    is parsed by its own typed parser. A failed child prevents parent
 *    construction; no cross-record read, `.find`, projection or digest runs.
 * 2. Local structure stage. Only once the whole subtree carries successful
 *    typed results are scalars, literals, nullable cells, dense bounds,
 *    codepoint/UTF-8 order, uniqueness, structural censuses and same-record
 *    time relations checked over those typed values.
 *
 * Any issue returns a sorted, frozen refusal. No `as`-cast, non-null assertion
 * or `undefined` cell ever bridges a failed child into a typed row.
 */
import {
  isCanonicalDecimal,
  isCanonicalTimestamp,
  isContractRelativePath,
  isSha256,
  snapshotClosedArray,
  snapshotClosedRecord,
  snapshotJson,
  type ContractRecord,
  type JsonValue,
  type ParseResult,
} from "./runtime.js";

export const repositoryProtectionSchemaVersions = Object.freeze([
  "repository-protection-receipt/v1",
] as const);

export const repositoryProtectionPurposes = Object.freeze([
  "ENVIRONMENT",
  "ENVIRONMENT_VARIABLE",
  "PULL_REQUEST",
  "PULL_REQUEST_REVIEWS",
  "REPOSITORY",
  "RULESET",
  "WORKFLOW_BUILD",
  "WORKFLOW_REVIEW",
  "WORKFLOW_RUN",
] as const);

export const repositoryProtectionPermissionNames = Object.freeze([
  "actions",
  "artifact-metadata",
  "attestations",
  "checks",
  "code-quality",
  "contents",
  "deployments",
  "discussions",
  "id-token",
  "issues",
  "models",
  "packages",
  "pages",
  "pull-requests",
  "security-events",
  "statuses",
  "vulnerability-alerts",
] as const);

export const repositoryProtectionSchemaFields = Object.freeze({
  receipt: Object.freeze([
    "apiObservations",
    "disposition",
    "environmentBinding",
    "expiresAt",
    "issuedAt",
    "producer",
    "protectedPathPolicies",
    "repositoryId",
    "reviewPolicy",
    "rulesetId",
    "rulesetSemanticDigest",
    "schemaVersion",
    "verifierAnchorDigest",
    "workflows",
  ] as const),
  reviewPolicy: Object.freeze([
    "adminBypass",
    "authorApproval",
    "committerApproval",
    "dismissalOnSourceChange",
    "minimumApprovals",
  ] as const),
  protectedPathPolicy: Object.freeze(["path", "reviewPolicy"] as const),
  workflow: Object.freeze([
    "digest",
    "path",
    "permissionNamespace",
    "permissions",
    "ref",
    "role",
    "trigger",
    "workflowId",
  ] as const),
  permission: Object.freeze(["access", "permission"] as const),
  trigger: Object.freeze([
    "activities",
    "event",
    "requiredConclusion",
    "sourceWorkflowDigest",
    "sourceWorkflowPath",
    "sourceWorkflowRef",
  ] as const),
  observation: Object.freeze([
    "completeReductionDigest",
    "completedAt",
    "pages",
    "purpose",
    "reducedValueDigest",
    "request",
    "requestIdentityDigest",
    "startedAt",
    "terminalPaginationDigest",
    "triggeringBuild",
  ] as const),
  restRequest: Object.freeze(["apiKind", "apiVersion", "method", "queryDigest", "route"] as const),
  graphqlRequest: Object.freeze([
    "apiKind",
    "apiVersion",
    "documentDigest",
    "method",
    "variablesDigest",
  ] as const),
  restPage: Object.freeze([
    "etag",
    "linkHeaderDigest",
    "linkRelations",
    "nextRequestDigest",
    "observedAt",
    "ordinal",
    "requestDigest",
    "responseDigest",
    "status",
  ] as const),
  graphqlPage: Object.freeze([
    "endCursor",
    "etag",
    "hasNextPage",
    "observedAt",
    "ordinal",
    "requestCursor",
    "requestDigest",
    "responseDigest",
    "status",
  ] as const),
  linkRelation: Object.freeze(["relation", "targetRequestDigest"] as const),
  triggeringBuild: Object.freeze([
    "completedAt",
    "conclusion",
    "runAttempt",
    "runId",
    "workflowDigest",
    "workflowPath",
    "workflowRef",
  ] as const),
  producer: Object.freeze([
    "artifactName",
    "runAttempt",
    "runId",
    "startedAt",
    "workflowDigest",
    "workflowPath",
    "workflowRef",
  ] as const),
  environmentBinding: Object.freeze([
    "environmentEtag",
    "environmentName",
    "variableName",
    "variableUpdatedAt",
    "variableValue",
  ] as const),
  completeReductionPage: Object.freeze(["ordinal", "responseDigest"] as const),
  rulesetSemantics: Object.freeze([
    "protectedPathPolicies",
    "repositoryId",
    "reviewPolicy",
    "rulesetId",
    "workflows",
  ] as const),
});

export type RepositoryProtectionSchemaVersion = (typeof repositoryProtectionSchemaVersions)[number];
export type RepositoryProtectionPurpose = (typeof repositoryProtectionPurposes)[number];
export type RepositoryProtectionPermissionName =
  (typeof repositoryProtectionPermissionNames)[number];
export type RepositoryProtectionDisposition = "ACCEPTED" | "BLOCK_REPLAN" | "REJECTED";
export type GitHubApiKind = "GRAPHQL" | "REST";
export type WorkflowPermissionAccess = "NONE" | "READ" | "WRITE";
export type WorkflowRole = "BUILD" | "REVIEW";
export type WorkflowTriggerEvent = "PULL_REQUEST" | "WORKFLOW_RUN";
export type WorkflowTriggerActivity = "completed" | "opened" | "reopened" | "synchronize";
export type RestLinkRelationName = "FIRST" | "LAST" | "NEXT" | "PREV";
export type Sha256Digest = string;
export type NullableRequestCursor = string | null;

/**
 * Typed result for the scalar and array census kinds. It is structurally the
 * runtime `ParseResult` shape, widened past its record-only constraint.
 */
export type StructuralParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly string[] };

export type ParsedReviewPolicy = ContractRecord &
  Readonly<{
    adminBypass: "FORBIDDEN";
    authorApproval: "FORBIDDEN";
    committerApproval: "FORBIDDEN";
    dismissalOnSourceChange: "REQUIRED";
    minimumApprovals: "1";
  }>;

export type ParsedProtectedPathPolicy = ContractRecord &
  Readonly<{ path: string; reviewPolicy: "INDEPENDENT_APPROVAL" }>;

export type ParsedWorkflowPermission = ContractRecord &
  Readonly<{ access: WorkflowPermissionAccess; permission: RepositoryProtectionPermissionName }>;

export type ParsedWorkflowTrigger = ContractRecord &
  Readonly<{
    activities: readonly WorkflowTriggerActivity[];
    event: WorkflowTriggerEvent;
    requiredConclusion: "SUCCESS" | null;
    sourceWorkflowDigest: string | null;
    sourceWorkflowPath: string | null;
    sourceWorkflowRef: string | null;
  }>;

export type ParsedWorkflow = ContractRecord &
  Readonly<{
    digest: string;
    path: string;
    permissionNamespace: "github-actions-permissions/2026-09-02";
    permissions: readonly ParsedWorkflowPermission[];
    ref: string;
    role: WorkflowRole;
    trigger: ParsedWorkflowTrigger;
    workflowId: string;
  }>;

export type ParsedRestRequest = ContractRecord &
  Readonly<{
    apiKind: "REST";
    apiVersion: "2022-11-28";
    method: "GET";
    queryDigest: string;
    route: string;
  }>;

export type ParsedGraphqlRequest = ContractRecord &
  Readonly<{
    apiKind: "GRAPHQL";
    apiVersion: null;
    documentDigest: string;
    method: "POST";
    variablesDigest: string;
  }>;

export type ParsedRepositoryProtectionRequest = ParsedGraphqlRequest | ParsedRestRequest;

export type ParsedRestLinkRelation = ContractRecord &
  Readonly<{ relation: RestLinkRelationName; targetRequestDigest: string }>;

export type ParsedRestPage = ContractRecord &
  Readonly<{
    etag: string;
    linkHeaderDigest: string | null;
    linkRelations: readonly ParsedRestLinkRelation[];
    nextRequestDigest: string | null;
    observedAt: string;
    ordinal: string;
    requestDigest: string;
    responseDigest: string;
    status: "200";
  }>;

export type ParsedGraphqlPage = ContractRecord &
  Readonly<{
    endCursor: string | null;
    etag: string | null;
    hasNextPage: boolean;
    observedAt: string;
    ordinal: string;
    requestCursor: string | null;
    requestDigest: string;
    responseDigest: string;
    status: "200";
  }>;

export type ParsedTerminalPaginationPages =
  readonly ParsedGraphqlPage[] | readonly ParsedRestPage[];

export type ParsedTriggeringBuild = ContractRecord &
  Readonly<{
    completedAt: string;
    conclusion: "SUCCESS";
    runAttempt: string;
    runId: string;
    workflowDigest: string;
    workflowPath: string;
    workflowRef: string;
  }>;

export type ParsedHistoricalApiObservation = ContractRecord &
  Readonly<{
    completeReductionDigest: string;
    completedAt: string;
    pages: ParsedTerminalPaginationPages;
    purpose: RepositoryProtectionPurpose;
    reducedValueDigest: string;
    request: ParsedRepositoryProtectionRequest;
    requestIdentityDigest: string;
    startedAt: string;
    terminalPaginationDigest: string;
    triggeringBuild: ParsedTriggeringBuild | null;
  }>;

export type ParsedReceiptProducer = ContractRecord &
  Readonly<{
    artifactName: string;
    runAttempt: string;
    runId: string;
    startedAt: string;
    workflowDigest: string;
    workflowPath: string;
    workflowRef: string;
  }>;

export type ParsedEnvironmentBinding = ContractRecord &
  Readonly<{
    environmentEtag: string;
    environmentName: "host-custody-bootstrap-root";
    variableName: "VERIFIER_ANCHOR_SHA256";
    variableUpdatedAt: string;
    variableValue: string;
  }>;

export type ParsedRepositoryProtectionStructure = ContractRecord &
  Readonly<{
    apiObservations: readonly ParsedHistoricalApiObservation[];
    disposition: RepositoryProtectionDisposition;
    environmentBinding: ParsedEnvironmentBinding;
    expiresAt: string;
    issuedAt: string;
    producer: ParsedReceiptProducer;
    protectedPathPolicies: readonly ParsedProtectedPathPolicy[];
    repositoryId: string;
    reviewPolicy: ParsedReviewPolicy;
    rulesetId: string;
    rulesetSemanticDigest: string;
    schemaVersion: RepositoryProtectionSchemaVersion;
    verifierAnchorDigest: string;
    workflows: readonly ParsedWorkflow[];
  }>;

/**
 * The retained historical public name for the parsed receipt tree. Packet B
 * re-exports this alias so the reviewed public type surface is unchanged; this
 * module never registers, serializes or exports the family itself.
 */
export type RepositoryProtectionReceipt = ParsedRepositoryProtectionStructure;

export type ParsedCompleteReductionPage = ContractRecord &
  Readonly<{ ordinal: string; responseDigest: string }>;

export type ParsedRulesetSemantics = ContractRecord &
  Readonly<{
    protectedPathPolicies: readonly ParsedProtectedPathPolicy[];
    repositoryId: string;
    reviewPolicy: ParsedReviewPolicy;
    rulesetId: string;
    workflows: readonly ParsedWorkflow[];
  }>;

const MAXIMUM_RECEIPT_LIFETIME_MS = 604_800_000;
const PROTECTED_PATH_ROWS = Object.freeze({ minimum: 1, maximum: 64 });
const PAGE_ROWS = Object.freeze({ minimum: 1, maximum: 64 });
const LINK_RELATION_ROWS = Object.freeze({ minimum: 0, maximum: 4 });
const ACTIVITY_ROWS = Object.freeze({ minimum: 1, maximum: 3 });
const BUILD_ACTIVITIES = Object.freeze(["opened", "reopened", "synchronize"] as const);
const REVIEW_ACTIVITIES = Object.freeze(["completed"] as const);
const WORKFLOW_TRIGGER_ACTIVITIES = Object.freeze([
  "completed",
  "opened",
  "reopened",
  "synchronize",
] as const);
const REPOSITORY_PROTECTION_DISPOSITIONS = Object.freeze([
  "ACCEPTED",
  "BLOCK_REPLAN",
  "REJECTED",
] as const);
const GITHUB_API_KINDS = Object.freeze(["GRAPHQL", "REST"] as const);
const WORKFLOW_TRIGGER_EVENTS = Object.freeze(["PULL_REQUEST", "WORKFLOW_RUN"] as const);
const WORKFLOW_ROLES = Object.freeze(["BUILD", "REVIEW"] as const);
const WORKFLOW_PERMISSION_ACCESS = Object.freeze(["NONE", "READ", "WRITE"] as const);
const REST_LINK_RELATION_NAMES = Object.freeze(["FIRST", "LAST", "NEXT", "PREV"] as const);
const RESTRICTED_PERMISSION_ACCESS: Readonly<Record<string, readonly WorkflowPermissionAccess[]>> =
  Object.freeze({
    "id-token": Object.freeze(["NONE", "WRITE"] as const),
    models: Object.freeze(["NONE", "READ"] as const),
    "vulnerability-alerts": Object.freeze(["NONE", "READ"] as const),
  });

type Issues = string[];

function refuse<T>(issues: readonly string[]): StructuralParseResult<T> {
  return { ok: false, issues: Object.freeze([...new Set(issues)].sort()) };
}

function frozen<T>(value: T): T {
  Object.freeze(value);
  return value;
}

function isJsonRecord(value: JsonValue): value is ContractRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Records a failed child's issues under its own path and reports the failure. */
function child<T>(result: StructuralParseResult<T>, prefix: string, issues: Issues): T | undefined {
  if (result.ok) return result.value;
  for (const issue of result.issues) issues.push(`${prefix}.${issue}`);
  return undefined;
}

function utf8Length(value: string): number {
  return Buffer.byteLength(value, "utf8");
}
function byteCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
function isPositiveId(value: JsonValue | undefined): value is string {
  return isCanonicalDecimal(value) && value !== "0";
}
function isContractPath(value: JsonValue | undefined): value is string {
  return isContractRelativePath(value) && utf8Length(value) <= 512;
}
function isSafeName(value: JsonValue | undefined): value is string {
  return (
    typeof value === "string" &&
    utf8Length(value) >= 1 &&
    utf8Length(value) <= 256 &&
    !/[\u0000-\u001f\u007f-\u009f/\\]/.test(value) &&
    value !== "." &&
    value !== ".."
  );
}
function isEtag(value: JsonValue | undefined): value is string {
  return typeof value === "string" && utf8Length(value) <= 1024 && /^[\x21-\x7e]+$/.test(value);
}
function isApiRoute(value: JsonValue | undefined): value is string {
  return (
    typeof value === "string" &&
    utf8Length(value) <= 512 &&
    /^\/[\x21-\x7e]*$/.test(value) &&
    !/[?#]/.test(value)
  );
}
function isRequestCursor(value: JsonValue | undefined): value is string {
  return (
    typeof value === "string" &&
    utf8Length(value) >= 1 &&
    utf8Length(value) <= 2048 &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}
function isBranchRef(value: JsonValue | undefined): value is string {
  if (typeof value !== "string" || utf8Length(value) > 512 || !value.startsWith("refs/heads/"))
    return false;
  const name = value.slice("refs/heads/".length);
  return (
    name.length > 0 &&
    !/[\u0000-\u0020\u007f-\u009f~^:?*[\\]/.test(name) &&
    !name.includes("..") &&
    !name.includes("//") &&
    !name.includes("@{") &&
    !name.endsWith("/") &&
    !name.endsWith(".") &&
    !name.endsWith(".lock") &&
    name
      .split("/")
      .every(
        (part) =>
          part !== "" &&
          part !== "." &&
          part !== ".." &&
          !part.startsWith(".") &&
          !part.endsWith(".lock"),
      )
  );
}
function isPageOrdinal(value: JsonValue | undefined): value is string {
  return isPositiveId(value) && Number(value) <= PAGE_ROWS.maximum;
}

/**
 * Local structure helpers. Each returns the narrowed typed value, or
 * `undefined` after recording an issue. `undefined` is never written into a
 * typed row: every construction site refuses first.
 */
function scalar<T extends JsonValue>(
  value: JsonValue | undefined,
  guard: (candidate: JsonValue | undefined) => candidate is T,
  issue: string,
  issues: Issues,
): T | undefined {
  if (guard(value)) return value;
  issues.push(issue);
  return undefined;
}
function literal<T extends JsonValue>(
  value: JsonValue | undefined,
  expected: T,
  issue: string,
  issues: Issues,
): T | undefined {
  if (value === expected) return expected;
  issues.push(issue);
  return undefined;
}
function member<T extends string>(
  value: JsonValue | undefined,
  allowed: readonly T[],
  issue: string,
  issues: Issues,
): T | undefined {
  for (const candidate of allowed) if (value === candidate) return candidate;
  issues.push(issue);
  return undefined;
}
function nullableScalar<T extends JsonValue>(
  value: JsonValue | undefined,
  guard: (candidate: JsonValue | undefined) => candidate is T,
  issue: string,
  issues: Issues,
): T | null | undefined {
  return value === null ? null : scalar(value, guard, issue, issues);
}
function booleanCell(
  value: JsonValue | undefined,
  issue: string,
  issues: Issues,
): boolean | undefined {
  if (typeof value === "boolean") return value;
  issues.push(issue);
  return undefined;
}

function parseTypedArray<T>(
  input: unknown,
  minimum: number,
  maximum: number,
  parseElement: (element: JsonValue) => StructuralParseResult<T>,
): StructuralParseResult<readonly T[]> {
  const snapshot = snapshotClosedArray(input);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const rows = snapshot.value;
  if (rows.length < minimum || rows.length > maximum) return refuse(["array:length"]);
  const issues: Issues = [];
  const values: T[] = [];
  rows.forEach((row, index) => {
    const parsed = child(parseElement(row), String(index), issues);
    if (parsed !== undefined) values.push(parsed);
  });
  if (issues.length > 0 || values.length !== rows.length) return refuse(issues);
  return { ok: true, value: frozen(values) };
}

function strictlyAscending(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined) return false;
    if (byteCompare(previous, current) >= 0) return false;
  }
  return true;
}

function sameSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/* -------------------------------------------------------------------------- *
 * Helper-argument scalar kinds
 * -------------------------------------------------------------------------- */

/** `Sha256Digest` helper input. */
export function parseSha256Digest(input: unknown): StructuralParseResult<Sha256Digest> {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const issues: Issues = [];
  const value = scalar(snapshot.value, isSha256, "digest:invalid", issues);
  if (issues.length > 0 || value === undefined) return refuse(issues);
  return { ok: true, value };
}

/** `NullableRequestCursor` helper input; a literal null cursor is a positive. */
export function parseNullableRequestCursor(
  input: unknown,
): StructuralParseResult<NullableRequestCursor> {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const issues: Issues = [];
  const value = nullableScalar(snapshot.value, isRequestCursor, "requestCursor:invalid", issues);
  if (issues.length > 0 || value === undefined) return refuse(issues);
  return { ok: true, value };
}

/** `RepositoryProtectionPurpose` helper input. */
export function parseRepositoryProtectionPurpose(
  input: unknown,
): StructuralParseResult<RepositoryProtectionPurpose> {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const issues: Issues = [];
  const value = member(snapshot.value, repositoryProtectionPurposes, "purpose:invalid", issues);
  if (issues.length > 0 || value === undefined) return refuse(issues);
  return { ok: true, value };
}

/** `GitHubApiKind` helper input. */
export function parseGitHubApiKind(input: unknown): StructuralParseResult<GitHubApiKind> {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const issues: Issues = [];
  const value = member(snapshot.value, GITHUB_API_KINDS, "apiKind:invalid", issues);
  if (issues.length > 0 || value === undefined) return refuse(issues);
  return { ok: true, value };
}

/** `RepositoryProtectionSchemaVersion` helper input. */
export function parseRepositoryProtectionSchemaVersion(
  input: unknown,
): StructuralParseResult<RepositoryProtectionSchemaVersion> {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const issues: Issues = [];
  const value = member(
    snapshot.value,
    repositoryProtectionSchemaVersions,
    "schemaVersion:invalid",
    issues,
  );
  if (issues.length > 0 || value === undefined) return refuse(issues);
  return { ok: true, value };
}

function parseWorkflowTriggerActivity(
  input: unknown,
): StructuralParseResult<WorkflowTriggerActivity> {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const issues: Issues = [];
  const value = member(snapshot.value, WORKFLOW_TRIGGER_ACTIVITIES, "activity:invalid", issues);
  if (issues.length > 0 || value === undefined) return refuse(issues);
  return { ok: true, value };
}

/* -------------------------------------------------------------------------- *
 * Receipt-tree record kinds
 * -------------------------------------------------------------------------- */

/** `ReviewPolicy`. */
export function parseReviewPolicy(input: unknown): ParseResult<ParsedReviewPolicy> {
  const snapshot = snapshotClosedRecord(input, repositoryProtectionSchemaFields.reviewPolicy);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const record = snapshot.value;
  const issues: Issues = [];
  const adminBypass = literal(record.adminBypass, "FORBIDDEN", "adminBypass:mismatch", issues);
  const authorApproval = literal(
    record.authorApproval,
    "FORBIDDEN",
    "authorApproval:mismatch",
    issues,
  );
  const committerApproval = literal(
    record.committerApproval,
    "FORBIDDEN",
    "committerApproval:mismatch",
    issues,
  );
  const dismissalOnSourceChange = literal(
    record.dismissalOnSourceChange,
    "REQUIRED",
    "dismissalOnSourceChange:mismatch",
    issues,
  );
  const minimumApprovals = literal(
    record.minimumApprovals,
    "1",
    "minimumApprovals:mismatch",
    issues,
  );
  if (
    issues.length > 0 ||
    adminBypass === undefined ||
    authorApproval === undefined ||
    committerApproval === undefined ||
    dismissalOnSourceChange === undefined ||
    minimumApprovals === undefined
  )
    return refuse(issues);
  const value: ParsedReviewPolicy = {
    adminBypass,
    authorApproval,
    committerApproval,
    dismissalOnSourceChange,
    minimumApprovals,
  };
  return { ok: true, value: frozen(value) };
}

/** `ProtectedPathPolicy`. */
export function parseProtectedPathPolicy(input: unknown): ParseResult<ParsedProtectedPathPolicy> {
  const snapshot = snapshotClosedRecord(
    input,
    repositoryProtectionSchemaFields.protectedPathPolicy,
  );
  if (!snapshot.ok) return refuse(snapshot.issues);
  const record = snapshot.value;
  const issues: Issues = [];
  const path = scalar(record.path, isContractPath, "path:invalid", issues);
  const reviewPolicy = literal(
    record.reviewPolicy,
    "INDEPENDENT_APPROVAL",
    "reviewPolicy:mismatch",
    issues,
  );
  if (issues.length > 0 || path === undefined || reviewPolicy === undefined) return refuse(issues);
  const value: ParsedProtectedPathPolicy = { path, reviewPolicy };
  return { ok: true, value: frozen(value) };
}

/** `ProtectedPathPolicy[]`: 1..64 dense rows, UTF-8 path order, no duplicate. */
export function parseProtectedPathPolicies(
  input: unknown,
): StructuralParseResult<readonly ParsedProtectedPathPolicy[]> {
  const rows = parseTypedArray(
    input,
    PROTECTED_PATH_ROWS.minimum,
    PROTECTED_PATH_ROWS.maximum,
    parseProtectedPathPolicy,
  );
  if (!rows.ok) return rows;
  if (!strictlyAscending(rows.value.map((row) => row.path))) return refuse(["order-or-duplicate"]);
  return rows;
}

/** `WorkflowPermission`. */
export function parseWorkflowPermission(input: unknown): ParseResult<ParsedWorkflowPermission> {
  const snapshot = snapshotClosedRecord(input, repositoryProtectionSchemaFields.permission);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const record = snapshot.value;
  const issues: Issues = [];
  const permission = member(
    record.permission,
    repositoryProtectionPermissionNames,
    "permission:invalid",
    issues,
  );
  const allowed =
    permission === undefined
      ? WORKFLOW_PERMISSION_ACCESS
      : (RESTRICTED_PERMISSION_ACCESS[permission] ?? WORKFLOW_PERMISSION_ACCESS);
  const access = member(record.access, allowed, "access:invalid", issues);
  if (issues.length > 0 || access === undefined || permission === undefined) return refuse(issues);
  const value: ParsedWorkflowPermission = { access, permission };
  return { ok: true, value: frozen(value) };
}

/** `WorkflowPermission[]`: the complete ordered seventeen-name snapshot. */
export function parseWorkflowPermissions(
  input: unknown,
): StructuralParseResult<readonly ParsedWorkflowPermission[]> {
  const rows = parseTypedArray(
    input,
    repositoryProtectionPermissionNames.length,
    repositoryProtectionPermissionNames.length,
    parseWorkflowPermission,
  );
  if (!rows.ok) return rows;
  const issues: Issues = [];
  rows.value.forEach((row, index) => {
    if (row.permission !== repositoryProtectionPermissionNames[index])
      issues.push(`${index}.permission:ordered-census-required`);
  });
  return issues.length > 0 ? refuse(issues) : rows;
}

/** `WorkflowTrigger.activities`: 1..3 dense UTF-8-sorted unique activities. */
export function parseWorkflowTriggerActivities(
  input: unknown,
): StructuralParseResult<readonly WorkflowTriggerActivity[]> {
  const rows = parseTypedArray(
    input,
    ACTIVITY_ROWS.minimum,
    ACTIVITY_ROWS.maximum,
    parseWorkflowTriggerActivity,
  );
  if (!rows.ok) return rows;
  if (!strictlyAscending(rows.value)) return refuse(["order-or-duplicate"]);
  return rows;
}

/**
 * `WorkflowTrigger`. The branch is classified from this record's own detached
 * `event` census; the workflow role pairing and the BUILD source equality stay
 * cross-record relations reserved for Packet B.
 */
export function parseWorkflowTrigger(input: unknown): ParseResult<ParsedWorkflowTrigger> {
  const snapshot = snapshotClosedRecord(input, repositoryProtectionSchemaFields.trigger);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const record = snapshot.value;
  const closure: Issues = [];
  const activities = child(
    parseWorkflowTriggerActivities(record.activities),
    "activities",
    closure,
  );
  if (closure.length > 0 || activities === undefined) return refuse(closure);
  const issues: Issues = [];
  const event = member(record.event, WORKFLOW_TRIGGER_EVENTS, "event:invalid", issues);
  if (event === undefined) return refuse(issues);
  if (event === "PULL_REQUEST") {
    if (!sameSequence(activities, BUILD_ACTIVITIES)) issues.push("activities:mismatch");
    const requiredConclusion = literal(
      record.requiredConclusion,
      null,
      "requiredConclusion:null-required",
      issues,
    );
    const sourceWorkflowDigest = literal(
      record.sourceWorkflowDigest,
      null,
      "sourceWorkflowDigest:null-required",
      issues,
    );
    const sourceWorkflowPath = literal(
      record.sourceWorkflowPath,
      null,
      "sourceWorkflowPath:null-required",
      issues,
    );
    const sourceWorkflowRef = literal(
      record.sourceWorkflowRef,
      null,
      "sourceWorkflowRef:null-required",
      issues,
    );
    if (
      issues.length > 0 ||
      requiredConclusion === undefined ||
      sourceWorkflowDigest === undefined ||
      sourceWorkflowPath === undefined ||
      sourceWorkflowRef === undefined
    )
      return refuse(issues);
    const buildValue: ParsedWorkflowTrigger = {
      activities,
      event,
      requiredConclusion,
      sourceWorkflowDigest,
      sourceWorkflowPath,
      sourceWorkflowRef,
    };
    return { ok: true, value: frozen(buildValue) };
  }
  if (!sameSequence(activities, REVIEW_ACTIVITIES)) issues.push("activities:mismatch");
  const requiredConclusion = literal(
    record.requiredConclusion,
    "SUCCESS",
    "requiredConclusion:mismatch",
    issues,
  );
  const sourceWorkflowDigest = scalar(
    record.sourceWorkflowDigest,
    isSha256,
    "sourceWorkflowDigest:invalid",
    issues,
  );
  const sourceWorkflowPath = scalar(
    record.sourceWorkflowPath,
    isContractPath,
    "sourceWorkflowPath:invalid",
    issues,
  );
  const sourceWorkflowRef = scalar(
    record.sourceWorkflowRef,
    isBranchRef,
    "sourceWorkflowRef:invalid",
    issues,
  );
  if (
    issues.length > 0 ||
    requiredConclusion === undefined ||
    sourceWorkflowDigest === undefined ||
    sourceWorkflowPath === undefined ||
    sourceWorkflowRef === undefined
  )
    return refuse(issues);
  const reviewValue: ParsedWorkflowTrigger = {
    activities,
    event,
    requiredConclusion,
    sourceWorkflowDigest,
    sourceWorkflowPath,
    sourceWorkflowRef,
  };
  return { ok: true, value: frozen(reviewValue) };
}

/** `Workflow`. */
export function parseWorkflow(input: unknown): ParseResult<ParsedWorkflow> {
  const snapshot = snapshotClosedRecord(input, repositoryProtectionSchemaFields.workflow);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const record = snapshot.value;
  const closure: Issues = [];
  const permissions = child(parseWorkflowPermissions(record.permissions), "permissions", closure);
  const trigger = child(parseWorkflowTrigger(record.trigger), "trigger", closure);
  if (closure.length > 0 || permissions === undefined || trigger === undefined)
    return refuse(closure);
  const issues: Issues = [];
  const digest = scalar(record.digest, isSha256, "digest:invalid", issues);
  const path = scalar(record.path, isContractPath, "path:invalid", issues);
  const permissionNamespace = literal(
    record.permissionNamespace,
    "github-actions-permissions/2026-09-02",
    "permissionNamespace:mismatch",
    issues,
  );
  const ref = scalar(record.ref, isBranchRef, "ref:invalid", issues);
  const role = member(record.role, WORKFLOW_ROLES, "role:invalid", issues);
  const workflowId = scalar(record.workflowId, isPositiveId, "workflowId:invalid", issues);
  if (
    issues.length > 0 ||
    digest === undefined ||
    path === undefined ||
    permissionNamespace === undefined ||
    ref === undefined ||
    role === undefined ||
    workflowId === undefined
  )
    return refuse(issues);
  const value: ParsedWorkflow = {
    digest,
    path,
    permissionNamespace,
    permissions,
    ref,
    role,
    trigger,
    workflowId,
  };
  return { ok: true, value: frozen(value) };
}

/** `Workflow[]`: exactly two UTF-8-path-ordered rows censusing both roles. */
export function parseWorkflows(input: unknown): StructuralParseResult<readonly ParsedWorkflow[]> {
  const rows = parseTypedArray(input, 2, 2, parseWorkflow);
  if (!rows.ok) return rows;
  const issues: Issues = [];
  if (!strictlyAscending(rows.value.map((row) => row.path))) issues.push("order-or-duplicate");
  const roles = rows.value.map((row) => row.role);
  for (const role of WORKFLOW_ROLES)
    if (roles.filter((candidate) => candidate === role).length !== 1)
      issues.push("role-census-required");
  return issues.length > 0 ? refuse(issues) : rows;
}

/** `RestRequest`. */
export function parseRestRequest(input: unknown): ParseResult<ParsedRestRequest> {
  const snapshot = snapshotClosedRecord(input, repositoryProtectionSchemaFields.restRequest);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const record = snapshot.value;
  const issues: Issues = [];
  const apiKind = literal(record.apiKind, "REST", "apiKind:mismatch", issues);
  const apiVersion = literal(record.apiVersion, "2022-11-28", "apiVersion:mismatch", issues);
  const method = literal(record.method, "GET", "method:mismatch", issues);
  const queryDigest = scalar(record.queryDigest, isSha256, "queryDigest:invalid", issues);
  const route = scalar(record.route, isApiRoute, "route:invalid", issues);
  if (
    issues.length > 0 ||
    apiKind === undefined ||
    apiVersion === undefined ||
    method === undefined ||
    queryDigest === undefined ||
    route === undefined
  )
    return refuse(issues);
  const value: ParsedRestRequest = { apiKind, apiVersion, method, queryDigest, route };
  return { ok: true, value: frozen(value) };
}

/** `GraphqlRequest`. */
export function parseGraphqlRequest(input: unknown): ParseResult<ParsedGraphqlRequest> {
  const snapshot = snapshotClosedRecord(input, repositoryProtectionSchemaFields.graphqlRequest);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const record = snapshot.value;
  const issues: Issues = [];
  const apiKind = literal(record.apiKind, "GRAPHQL", "apiKind:mismatch", issues);
  const apiVersion = literal(record.apiVersion, null, "apiVersion:null-required", issues);
  const documentDigest = scalar(record.documentDigest, isSha256, "documentDigest:invalid", issues);
  const method = literal(record.method, "POST", "method:mismatch", issues);
  const variablesDigest = scalar(
    record.variablesDigest,
    isSha256,
    "variablesDigest:invalid",
    issues,
  );
  if (
    issues.length > 0 ||
    apiKind === undefined ||
    apiVersion === undefined ||
    documentDigest === undefined ||
    method === undefined ||
    variablesDigest === undefined
  )
    return refuse(issues);
  const value: ParsedGraphqlRequest = {
    apiKind,
    apiVersion,
    documentDigest,
    method,
    variablesDigest,
  };
  return { ok: true, value: frozen(value) };
}

/**
 * `RepositoryProtectionRequest`. The root is detached once before its own
 * `apiKind` census is read, so no proxy, getter or descriptor trap can select a
 * branch; the concrete branch parser then re-closes that detached record.
 */
export function parseRepositoryProtectionRequest(
  input: unknown,
): StructuralParseResult<ParsedRepositoryProtectionRequest> {
  const snapshot = snapshotJson(input);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const detached = snapshot.value;
  if (!isJsonRecord(detached)) return refuse(["record:object-required"]);
  if (detached.apiKind === "REST") return parseRestRequest(detached);
  if (detached.apiKind === "GRAPHQL") return parseGraphqlRequest(detached);
  return refuse(["apiKind:invalid"]);
}

/** `RestLinkRelation`. */
export function parseRestLinkRelation(input: unknown): ParseResult<ParsedRestLinkRelation> {
  const snapshot = snapshotClosedRecord(input, repositoryProtectionSchemaFields.linkRelation);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const record = snapshot.value;
  const issues: Issues = [];
  const relation = member(record.relation, REST_LINK_RELATION_NAMES, "relation:invalid", issues);
  const targetRequestDigest = scalar(
    record.targetRequestDigest,
    isSha256,
    "targetRequestDigest:invalid",
    issues,
  );
  if (issues.length > 0 || relation === undefined || targetRequestDigest === undefined)
    return refuse(issues);
  const value: ParsedRestLinkRelation = { relation, targetRequestDigest };
  return { ok: true, value: frozen(value) };
}

/** `RestLinkRelation[]`: 0..4 dense rows, UTF-8 relation order, unique names. */
export function parseRestLinkRelations(
  input: unknown,
): StructuralParseResult<readonly ParsedRestLinkRelation[]> {
  const rows = parseTypedArray(
    input,
    LINK_RELATION_ROWS.minimum,
    LINK_RELATION_ROWS.maximum,
    parseRestLinkRelation,
  );
  if (!rows.ok) return rows;
  if (!strictlyAscending(rows.value.map((row) => row.relation)))
    return refuse(["order-or-duplicate"]);
  return rows;
}

/** `RestPage`. Chain targets, boundaries and ordinal adjacency stay in Packet B. */
export function parseRestPage(input: unknown): ParseResult<ParsedRestPage> {
  const snapshot = snapshotClosedRecord(input, repositoryProtectionSchemaFields.restPage);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const record = snapshot.value;
  const closure: Issues = [];
  const linkRelations = child(
    parseRestLinkRelations(record.linkRelations),
    "linkRelations",
    closure,
  );
  if (closure.length > 0 || linkRelations === undefined) return refuse(closure);
  const issues: Issues = [];
  const etag = scalar(record.etag, isEtag, "etag:invalid", issues);
  const linkHeaderDigest = nullableScalar(
    record.linkHeaderDigest,
    isSha256,
    "linkHeaderDigest:invalid",
    issues,
  );
  const nextRequestDigest = nullableScalar(
    record.nextRequestDigest,
    isSha256,
    "nextRequestDigest:invalid",
    issues,
  );
  const observedAt = scalar(record.observedAt, isCanonicalTimestamp, "observedAt:invalid", issues);
  const ordinal = scalar(record.ordinal, isPageOrdinal, "ordinal:invalid", issues);
  const requestDigest = scalar(record.requestDigest, isSha256, "requestDigest:invalid", issues);
  const responseDigest = scalar(record.responseDigest, isSha256, "responseDigest:invalid", issues);
  const status = literal(record.status, "200", "status:mismatch", issues);
  if (
    linkHeaderDigest !== undefined &&
    (linkRelations.length === 0) !== (linkHeaderDigest === null)
  )
    issues.push("linkHeaderDigest:nullability");
  if (
    issues.length > 0 ||
    etag === undefined ||
    linkHeaderDigest === undefined ||
    nextRequestDigest === undefined ||
    observedAt === undefined ||
    ordinal === undefined ||
    requestDigest === undefined ||
    responseDigest === undefined ||
    status === undefined
  )
    return refuse(issues);
  const value: ParsedRestPage = {
    etag,
    linkHeaderDigest,
    linkRelations,
    nextRequestDigest,
    observedAt,
    ordinal,
    requestDigest,
    responseDigest,
    status,
  };
  return { ok: true, value: frozen(value) };
}

/** `GraphqlPage`. Cursor acquisition and terminal state stay in Packet B. */
export function parseGraphqlPage(input: unknown): ParseResult<ParsedGraphqlPage> {
  const snapshot = snapshotClosedRecord(input, repositoryProtectionSchemaFields.graphqlPage);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const record = snapshot.value;
  const issues: Issues = [];
  const endCursor = nullableScalar(record.endCursor, isRequestCursor, "endCursor:invalid", issues);
  const etag = nullableScalar(record.etag, isEtag, "etag:invalid", issues);
  const hasNextPage = booleanCell(record.hasNextPage, "hasNextPage:invalid", issues);
  const observedAt = scalar(record.observedAt, isCanonicalTimestamp, "observedAt:invalid", issues);
  const ordinal = scalar(record.ordinal, isPageOrdinal, "ordinal:invalid", issues);
  const requestCursor = nullableScalar(
    record.requestCursor,
    isRequestCursor,
    "requestCursor:invalid",
    issues,
  );
  const requestDigest = scalar(record.requestDigest, isSha256, "requestDigest:invalid", issues);
  const responseDigest = scalar(record.responseDigest, isSha256, "responseDigest:invalid", issues);
  const status = literal(record.status, "200", "status:mismatch", issues);
  if (
    issues.length > 0 ||
    endCursor === undefined ||
    etag === undefined ||
    hasNextPage === undefined ||
    observedAt === undefined ||
    ordinal === undefined ||
    requestCursor === undefined ||
    requestDigest === undefined ||
    responseDigest === undefined ||
    status === undefined
  )
    return refuse(issues);
  const value: ParsedGraphqlPage = {
    endCursor,
    etag,
    hasNextPage,
    observedAt,
    ordinal,
    requestCursor,
    requestDigest,
    responseDigest,
    status,
  };
  return { ok: true, value: frozen(value) };
}

/** `RestPage[]`: 1..64 dense rows. */
export function parseRestPages(input: unknown): StructuralParseResult<readonly ParsedRestPage[]> {
  return parseTypedArray(input, PAGE_ROWS.minimum, PAGE_ROWS.maximum, parseRestPage);
}

/** `GraphqlPage[]`: 1..64 dense rows. */
export function parseGraphqlPages(
  input: unknown,
): StructuralParseResult<readonly ParsedGraphqlPage[]> {
  return parseTypedArray(input, PAGE_ROWS.minimum, PAGE_ROWS.maximum, parseGraphqlPage);
}

/**
 * `TerminalPaginationPages`. The branch is selected only from an already parsed
 * `GitHubApiKind`, never from a raw discriminator.
 */
export function parseTerminalPaginationPages(
  apiKind: GitHubApiKind,
  input: unknown,
): StructuralParseResult<ParsedTerminalPaginationPages> {
  return apiKind === "REST" ? parseRestPages(input) : parseGraphqlPages(input);
}

/** `TriggeringBuild`. */
export function parseTriggeringBuild(input: unknown): ParseResult<ParsedTriggeringBuild> {
  const snapshot = snapshotClosedRecord(input, repositoryProtectionSchemaFields.triggeringBuild);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const record = snapshot.value;
  const issues: Issues = [];
  const completedAt = scalar(
    record.completedAt,
    isCanonicalTimestamp,
    "completedAt:invalid",
    issues,
  );
  const conclusion = literal(record.conclusion, "SUCCESS", "conclusion:mismatch", issues);
  const runAttempt = scalar(record.runAttempt, isPositiveId, "runAttempt:invalid", issues);
  const runId = scalar(record.runId, isPositiveId, "runId:invalid", issues);
  const workflowDigest = scalar(record.workflowDigest, isSha256, "workflowDigest:invalid", issues);
  const workflowPath = scalar(record.workflowPath, isContractPath, "workflowPath:invalid", issues);
  const workflowRef = scalar(record.workflowRef, isBranchRef, "workflowRef:invalid", issues);
  if (
    issues.length > 0 ||
    completedAt === undefined ||
    conclusion === undefined ||
    runAttempt === undefined ||
    runId === undefined ||
    workflowDigest === undefined ||
    workflowPath === undefined ||
    workflowRef === undefined
  )
    return refuse(issues);
  const value: ParsedTriggeringBuild = {
    completedAt,
    conclusion,
    runAttempt,
    runId,
    workflowDigest,
    workflowPath,
    workflowRef,
  };
  return { ok: true, value: frozen(value) };
}

/**
 * `HistoricalApiObservation`. The page branch comes from this row's own typed
 * request and the triggering-build nullability from its own typed purpose; both
 * are same-record reads of successfully parsed values.
 */
export function parseHistoricalApiObservation(
  input: unknown,
): ParseResult<ParsedHistoricalApiObservation> {
  const snapshot = snapshotClosedRecord(input, repositoryProtectionSchemaFields.observation);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const record = snapshot.value;
  const closure: Issues = [];
  const purpose = child(parseRepositoryProtectionPurpose(record.purpose), "purpose", closure);
  const request = child(parseRepositoryProtectionRequest(record.request), "request", closure);
  if (purpose === undefined || request === undefined) return refuse(closure);
  const pages = child(
    parseTerminalPaginationPages(request.apiKind, record.pages),
    "pages",
    closure,
  );
  let triggeringBuild: ParsedTriggeringBuild | null | undefined;
  if (purpose === "WORKFLOW_RUN")
    triggeringBuild = child(
      parseTriggeringBuild(record.triggeringBuild),
      "triggeringBuild",
      closure,
    );
  else if (record.triggeringBuild === null) triggeringBuild = null;
  else closure.push("triggeringBuild:null-required");
  if (closure.length > 0 || pages === undefined || triggeringBuild === undefined)
    return refuse(closure);
  const issues: Issues = [];
  const completeReductionDigest = scalar(
    record.completeReductionDigest,
    isSha256,
    "completeReductionDigest:invalid",
    issues,
  );
  const completedAt = scalar(
    record.completedAt,
    isCanonicalTimestamp,
    "completedAt:invalid",
    issues,
  );
  const reducedValueDigest = scalar(
    record.reducedValueDigest,
    isSha256,
    "reducedValueDigest:invalid",
    issues,
  );
  const requestIdentityDigest = scalar(
    record.requestIdentityDigest,
    isSha256,
    "requestIdentityDigest:invalid",
    issues,
  );
  const startedAt = scalar(record.startedAt, isCanonicalTimestamp, "startedAt:invalid", issues);
  const terminalPaginationDigest = scalar(
    record.terminalPaginationDigest,
    isSha256,
    "terminalPaginationDigest:invalid",
    issues,
  );
  if (startedAt !== undefined && completedAt !== undefined && startedAt > completedAt)
    issues.push("time-order");
  if (
    issues.length > 0 ||
    completeReductionDigest === undefined ||
    completedAt === undefined ||
    reducedValueDigest === undefined ||
    requestIdentityDigest === undefined ||
    startedAt === undefined ||
    terminalPaginationDigest === undefined
  )
    return refuse(issues);
  const value: ParsedHistoricalApiObservation = {
    completeReductionDigest,
    completedAt,
    pages,
    purpose,
    reducedValueDigest,
    request,
    requestIdentityDigest,
    startedAt,
    terminalPaginationDigest,
    triggeringBuild,
  };
  return { ok: true, value: frozen(value) };
}

/** `HistoricalApiObservation[]`: the ordered nine-purpose census. */
export function parseHistoricalApiObservations(
  input: unknown,
): StructuralParseResult<readonly ParsedHistoricalApiObservation[]> {
  const rows = parseTypedArray(
    input,
    repositoryProtectionPurposes.length,
    repositoryProtectionPurposes.length,
    parseHistoricalApiObservation,
  );
  if (!rows.ok) return rows;
  const issues: Issues = [];
  rows.value.forEach((row, index) => {
    if (row.purpose !== repositoryProtectionPurposes[index])
      issues.push(`${index}.purpose:ordered-census-required`);
  });
  return issues.length > 0 ? refuse(issues) : rows;
}

/** `ReceiptProducer`. Its binding to the REVIEW row belongs to Packet B. */
export function parseReceiptProducer(input: unknown): ParseResult<ParsedReceiptProducer> {
  const snapshot = snapshotClosedRecord(input, repositoryProtectionSchemaFields.producer);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const record = snapshot.value;
  const issues: Issues = [];
  const artifactName = scalar(record.artifactName, isSafeName, "artifactName:invalid", issues);
  const runAttempt = scalar(record.runAttempt, isPositiveId, "runAttempt:invalid", issues);
  const runId = scalar(record.runId, isPositiveId, "runId:invalid", issues);
  const startedAt = scalar(record.startedAt, isCanonicalTimestamp, "startedAt:invalid", issues);
  const workflowDigest = scalar(record.workflowDigest, isSha256, "workflowDigest:invalid", issues);
  const workflowPath = scalar(record.workflowPath, isContractPath, "workflowPath:invalid", issues);
  const workflowRef = scalar(record.workflowRef, isBranchRef, "workflowRef:invalid", issues);
  if (
    issues.length > 0 ||
    artifactName === undefined ||
    runAttempt === undefined ||
    runId === undefined ||
    startedAt === undefined ||
    workflowDigest === undefined ||
    workflowPath === undefined ||
    workflowRef === undefined
  )
    return refuse(issues);
  const value: ParsedReceiptProducer = {
    artifactName,
    runAttempt,
    runId,
    startedAt,
    workflowDigest,
    workflowPath,
    workflowRef,
  };
  return { ok: true, value: frozen(value) };
}

/**
 * `EnvironmentBinding`. Its equality with the top-level anchor digest and its
 * chronology against the producer are cross-record relations for Packet B.
 */
export function parseEnvironmentBinding(input: unknown): ParseResult<ParsedEnvironmentBinding> {
  const snapshot = snapshotClosedRecord(input, repositoryProtectionSchemaFields.environmentBinding);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const record = snapshot.value;
  const issues: Issues = [];
  const environmentEtag = scalar(record.environmentEtag, isEtag, "environmentEtag:invalid", issues);
  const environmentName = literal(
    record.environmentName,
    "host-custody-bootstrap-root",
    "environmentName:mismatch",
    issues,
  );
  const variableName = literal(
    record.variableName,
    "VERIFIER_ANCHOR_SHA256",
    "variableName:mismatch",
    issues,
  );
  const variableUpdatedAt = scalar(
    record.variableUpdatedAt,
    isCanonicalTimestamp,
    "variableUpdatedAt:invalid",
    issues,
  );
  const variableValue = scalar(record.variableValue, isSha256, "variableValue:invalid", issues);
  if (
    issues.length > 0 ||
    environmentEtag === undefined ||
    environmentName === undefined ||
    variableName === undefined ||
    variableUpdatedAt === undefined ||
    variableValue === undefined
  )
    return refuse(issues);
  const value: ParsedEnvironmentBinding = {
    environmentEtag,
    environmentName,
    variableName,
    variableUpdatedAt,
    variableValue,
  };
  return { ok: true, value: frozen(value) };
}

/* -------------------------------------------------------------------------- *
 * Standalone helper-input record kinds
 * -------------------------------------------------------------------------- */

/** `CompleteReductionPage`: the closed reduction projection row. */
export function parseCompleteReductionPage(
  input: unknown,
): ParseResult<ParsedCompleteReductionPage> {
  const snapshot = snapshotClosedRecord(
    input,
    repositoryProtectionSchemaFields.completeReductionPage,
  );
  if (!snapshot.ok) return refuse(snapshot.issues);
  const record = snapshot.value;
  const issues: Issues = [];
  const ordinal = scalar(record.ordinal, isPageOrdinal, "ordinal:invalid", issues);
  const responseDigest = scalar(record.responseDigest, isSha256, "responseDigest:invalid", issues);
  if (issues.length > 0 || ordinal === undefined || responseDigest === undefined)
    return refuse(issues);
  const value: ParsedCompleteReductionPage = { ordinal, responseDigest };
  return { ok: true, value: frozen(value) };
}

/** `CompleteReductionPage[]`: 1..64 dense rows. */
export function parseCompleteReductionPages(
  input: unknown,
): StructuralParseResult<readonly ParsedCompleteReductionPage[]> {
  return parseTypedArray(input, PAGE_ROWS.minimum, PAGE_ROWS.maximum, parseCompleteReductionPage);
}

/** `RulesetSemantics`: the standalone five-member semantic projection input. */
export function parseRulesetSemantics(input: unknown): ParseResult<ParsedRulesetSemantics> {
  const snapshot = snapshotClosedRecord(input, repositoryProtectionSchemaFields.rulesetSemantics);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const record = snapshot.value;
  const closure: Issues = [];
  const protectedPathPolicies = child(
    parseProtectedPathPolicies(record.protectedPathPolicies),
    "protectedPathPolicies",
    closure,
  );
  const reviewPolicy = child(parseReviewPolicy(record.reviewPolicy), "reviewPolicy", closure);
  const workflows = child(parseWorkflows(record.workflows), "workflows", closure);
  if (
    closure.length > 0 ||
    protectedPathPolicies === undefined ||
    reviewPolicy === undefined ||
    workflows === undefined
  )
    return refuse(closure);
  const issues: Issues = [];
  const repositoryId = scalar(record.repositoryId, isPositiveId, "repositoryId:invalid", issues);
  const rulesetId = scalar(record.rulesetId, isPositiveId, "rulesetId:invalid", issues);
  if (issues.length > 0 || repositoryId === undefined || rulesetId === undefined)
    return refuse(issues);
  const value: ParsedRulesetSemantics = {
    protectedPathPolicies,
    repositoryId,
    reviewPolicy,
    rulesetId,
    workflows,
  };
  return { ok: true, value: frozen(value) };
}

/* -------------------------------------------------------------------------- *
 * Structure-only entry point
 * -------------------------------------------------------------------------- */

/**
 * `RepositoryProtectionReceiptStructure`: the structure-only entry point.
 *
 * Success means the supplied tree is detached, closed, typed and locally well
 * formed. It is not an accepted receipt: cross-record equality, chronology,
 * pagination handoff, semantic projection, digest recomputation, registration
 * and serialization all remain with Packet B, and the public schema family
 * still reports `schemaVersion:unsupported`.
 */
export function parseRepositoryProtectionStructure(
  input: unknown,
): ParseResult<ParsedRepositoryProtectionStructure> {
  const snapshot = snapshotClosedRecord(input, repositoryProtectionSchemaFields.receipt);
  if (!snapshot.ok) return refuse(snapshot.issues);
  const record = snapshot.value;
  const closure: Issues = [];
  const apiObservations = child(
    parseHistoricalApiObservations(record.apiObservations),
    "apiObservations",
    closure,
  );
  const environmentBinding = child(
    parseEnvironmentBinding(record.environmentBinding),
    "environmentBinding",
    closure,
  );
  const producer = child(parseReceiptProducer(record.producer), "producer", closure);
  const protectedPathPolicies = child(
    parseProtectedPathPolicies(record.protectedPathPolicies),
    "protectedPathPolicies",
    closure,
  );
  const reviewPolicy = child(parseReviewPolicy(record.reviewPolicy), "reviewPolicy", closure);
  const workflows = child(parseWorkflows(record.workflows), "workflows", closure);
  if (
    closure.length > 0 ||
    apiObservations === undefined ||
    environmentBinding === undefined ||
    producer === undefined ||
    protectedPathPolicies === undefined ||
    reviewPolicy === undefined ||
    workflows === undefined
  )
    return refuse(closure);
  const issues: Issues = [];
  const disposition = member(
    record.disposition,
    REPOSITORY_PROTECTION_DISPOSITIONS,
    "disposition:invalid",
    issues,
  );
  const expiresAt = scalar(record.expiresAt, isCanonicalTimestamp, "expiresAt:invalid", issues);
  const issuedAt = scalar(record.issuedAt, isCanonicalTimestamp, "issuedAt:invalid", issues);
  const repositoryId = scalar(record.repositoryId, isPositiveId, "repositoryId:invalid", issues);
  const rulesetId = scalar(record.rulesetId, isPositiveId, "rulesetId:invalid", issues);
  const rulesetSemanticDigest = scalar(
    record.rulesetSemanticDigest,
    isSha256,
    "rulesetSemanticDigest:invalid",
    issues,
  );
  const schemaVersion = literal(
    record.schemaVersion,
    "repository-protection-receipt/v1",
    "schemaVersion:mismatch",
    issues,
  );
  const verifierAnchorDigest = scalar(
    record.verifierAnchorDigest,
    isSha256,
    "verifierAnchorDigest:invalid",
    issues,
  );
  if (issuedAt !== undefined && expiresAt !== undefined) {
    const lifetime = Date.parse(expiresAt) - Date.parse(issuedAt);
    if (lifetime <= 0) issues.push("expiresAt:not-after-issuedAt");
    if (lifetime > MAXIMUM_RECEIPT_LIFETIME_MS) issues.push("expiresAt:more-than-seven-days");
  }
  if (
    issues.length > 0 ||
    disposition === undefined ||
    expiresAt === undefined ||
    issuedAt === undefined ||
    repositoryId === undefined ||
    rulesetId === undefined ||
    rulesetSemanticDigest === undefined ||
    schemaVersion === undefined ||
    verifierAnchorDigest === undefined
  )
    return refuse(issues);
  const value: ParsedRepositoryProtectionStructure = {
    apiObservations,
    disposition,
    environmentBinding,
    expiresAt,
    issuedAt,
    producer,
    protectedPathPolicies,
    repositoryId,
    reviewPolicy,
    rulesetId,
    rulesetSemanticDigest,
    schemaVersion,
    verifierAnchorDigest,
    workflows,
  };
  return { ok: true, value: frozen(value) };
}

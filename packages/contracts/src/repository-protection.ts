import {
  frame,
  framedDigest,
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
    "completedAt",
    "completeReductionDigest",
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

type Purpose = (typeof repositoryProtectionPurposes)[number];
type ApiKind = "GRAPHQL" | "REST";
export type RepositoryProtectionReceipt = Readonly<{
  apiObservations: readonly ContractRecord[];
  disposition: "ACCEPTED" | "REJECTED" | "BLOCK_REPLAN";
  environmentBinding: ContractRecord;
  expiresAt: string;
  issuedAt: string;
  producer: ContractRecord;
  protectedPathPolicies: readonly ContractRecord[];
  repositoryId: string;
  reviewPolicy: ContractRecord;
  rulesetId: string;
  rulesetSemanticDigest: string;
  schemaVersion: "repository-protection-receipt/v1";
  verifierAnchorDigest: string;
  workflows: readonly ContractRecord[];
}>;

const fail = (...issues: readonly string[]): ParseResult<RepositoryProtectionReceipt> => ({
  ok: false,
  issues: Object.freeze([...new Set(issues)].sort()),
});
const positiveId = (value: JsonValue | undefined): value is string =>
  isCanonicalDecimal(value) && value !== "0";
const digest = (value: JsonValue | undefined): value is string => isSha256(value);
const timestamp = (value: JsonValue | undefined): value is string => isCanonicalTimestamp(value);
const utf8Length = (value: string): number => Buffer.byteLength(value, "utf8");
const path = (value: JsonValue | undefined): value is string =>
  isContractRelativePath(value) && utf8Length(value) <= 512;
const safeName = (value: JsonValue | undefined): value is string =>
  typeof value === "string" &&
  utf8Length(value) >= 1 &&
  utf8Length(value) <= 256 &&
  !/[\u0000-\u001f\u007f-\u009f/\\]/.test(value) &&
  value !== "." &&
  value !== "..";
const etag = (value: JsonValue | undefined): value is string =>
  typeof value === "string" && utf8Length(value) <= 1024 && /^[\x21-\x7e]+$/.test(value);
const route = (value: JsonValue | undefined): value is string =>
  typeof value === "string" &&
  utf8Length(value) <= 512 &&
  /^\/[\x21-\x7e]*$/.test(value) &&
  !/[?#]/.test(value);
const cursor = (value: JsonValue | undefined): value is string =>
  typeof value === "string" &&
  utf8Length(value) >= 1 &&
  utf8Length(value) <= 2048 &&
  !/[\u0000-\u001f\u007f-\u009f]/.test(value);
function branchRef(value: JsonValue | undefined): value is string {
  if (typeof value !== "string" || utf8Length(value) > 512 || !value.startsWith("refs/heads/"))
    return false;
  const name = value.slice("refs/heads/".length);
  return (
    name.length > 0 &&
    !/[\u0000-\u0020\u007f-\u009f~^:?*\[\\]/.test(name) &&
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
function inPurpose(value: JsonValue | undefined): value is Purpose {
  return (repositoryProtectionPurposes as readonly JsonValue[]).includes(value as JsonValue);
}
function byteCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
function nestedRecord(
  value: JsonValue | undefined,
  fields: readonly string[],
  prefix: string,
  issues: string[],
): ContractRecord | null {
  const parsed = snapshotClosedRecord(value, fields);
  if (!parsed.ok) {
    issues.push(...parsed.issues.map((issue) => `${prefix}.${issue}`));
    return null;
  }
  return parsed.value;
}
function nestedArray(
  value: JsonValue | undefined,
  minimum: number,
  maximum: number,
  prefix: string,
  issues: string[],
): readonly JsonValue[] | null {
  const parsed = snapshotClosedArray(value);
  if (!parsed.ok) {
    issues.push(...parsed.issues.map((issue) => `${prefix}.${issue}`));
    return null;
  }
  if (parsed.value.length < minimum || parsed.value.length > maximum) {
    issues.push(`${prefix}:length`);
    return null;
  }
  return parsed.value;
}
function validateReviewPolicy(
  value: JsonValue | undefined,
  prefix: string,
  issues: string[],
): ContractRecord | null {
  const row = nestedRecord(value, repositoryProtectionSchemaFields.reviewPolicy, prefix, issues);
  if (!row) return null;
  const literals = {
    adminBypass: "FORBIDDEN",
    authorApproval: "FORBIDDEN",
    committerApproval: "FORBIDDEN",
    dismissalOnSourceChange: "REQUIRED",
    minimumApprovals: "1",
  } as const;
  for (const [field, expected] of Object.entries(literals))
    if (row[field] !== expected) issues.push(`${prefix}.${field}:mismatch`);
  return row;
}
function validateProtectedPaths(
  value: JsonValue | undefined,
  prefix: string,
  issues: string[],
): readonly ContractRecord[] | null {
  const rows = nestedArray(value, 1, 64, prefix, issues);
  if (!rows) return null;
  const parsed: ContractRecord[] = [];
  rows.forEach((value, index) => {
    const row = nestedRecord(
      value,
      repositoryProtectionSchemaFields.protectedPathPolicy,
      `${prefix}.${index}`,
      issues,
    );
    if (!row) return;
    if (!path(row.path)) issues.push(`${prefix}.${index}.path:invalid`);
    if (row.reviewPolicy !== "INDEPENDENT_APPROVAL")
      issues.push(`${prefix}.${index}.reviewPolicy:mismatch`);
    parsed.push(row);
  });
  for (let index = 1; index < parsed.length; index += 1)
    if (
      typeof parsed[index - 1]!.path === "string" &&
      typeof parsed[index]!.path === "string" &&
      byteCompare(parsed[index - 1]!.path as string, parsed[index]!.path as string) >= 0
    )
      issues.push(`${prefix}:order-or-duplicate`);
  return parsed;
}
function validateTrigger(
  value: JsonValue | undefined,
  role: JsonValue | undefined,
  prefix: string,
  issues: string[],
): ContractRecord | null {
  const row = nestedRecord(value, repositoryProtectionSchemaFields.trigger, prefix, issues);
  if (!row) return null;
  const activities = nestedArray(row.activities, 1, 3, `${prefix}.activities`, issues);
  if (role === "BUILD") {
    if (row.event !== "PULL_REQUEST") issues.push(`${prefix}.event:mismatch`);
    if (
      !activities ||
      activities.length !== 3 ||
      activities[0] !== "opened" ||
      activities[1] !== "reopened" ||
      activities[2] !== "synchronize"
    )
      issues.push(`${prefix}.activities:mismatch`);
    for (const field of [
      "requiredConclusion",
      "sourceWorkflowDigest",
      "sourceWorkflowPath",
      "sourceWorkflowRef",
    ])
      if (row[field] !== null) issues.push(`${prefix}.${field}:null-required`);
  } else if (role === "REVIEW") {
    if (row.event !== "WORKFLOW_RUN") issues.push(`${prefix}.event:mismatch`);
    if (!activities || activities.length !== 1 || activities[0] !== "completed")
      issues.push(`${prefix}.activities:mismatch`);
    if (row.requiredConclusion !== "SUCCESS") issues.push(`${prefix}.requiredConclusion:mismatch`);
    if (!digest(row.sourceWorkflowDigest)) issues.push(`${prefix}.sourceWorkflowDigest:invalid`);
    if (!path(row.sourceWorkflowPath)) issues.push(`${prefix}.sourceWorkflowPath:invalid`);
    if (!branchRef(row.sourceWorkflowRef)) issues.push(`${prefix}.sourceWorkflowRef:invalid`);
  } else issues.push(`${prefix}:unknown-role`);
  return row;
}
function validateWorkflows(
  value: JsonValue | undefined,
  prefix: string,
  issues: string[],
): readonly ContractRecord[] | null {
  const values = nestedArray(value, 2, 2, prefix, issues);
  if (!values) return null;
  const rows: ContractRecord[] = [];
  values.forEach((value, index) => {
    const p = `${prefix}.${index}`;
    const row = nestedRecord(value, repositoryProtectionSchemaFields.workflow, p, issues);
    if (!row) return;
    if (!digest(row.digest)) issues.push(`${p}.digest:invalid`);
    if (!path(row.path)) issues.push(`${p}.path:invalid`);
    if (!branchRef(row.ref)) issues.push(`${p}.ref:invalid`);
    if (!positiveId(row.workflowId)) issues.push(`${p}.workflowId:invalid`);
    if (row.role !== "BUILD" && row.role !== "REVIEW") issues.push(`${p}.role:invalid`);
    if (row.permissionNamespace !== "github-actions-permissions/2026-09-02")
      issues.push(`${p}.permissionNamespace:mismatch`);
    const permissions = nestedArray(row.permissions, 17, 17, `${p}.permissions`, issues);
    if (permissions)
      permissions.forEach((value, permissionIndex) => {
        const pp = `${p}.permissions.${permissionIndex}`;
        const permission = nestedRecord(
          value,
          repositoryProtectionSchemaFields.permission,
          pp,
          issues,
        );
        if (!permission) return;
        const expected = repositoryProtectionPermissionNames[permissionIndex];
        if (permission.permission !== expected)
          issues.push(`${pp}.permission:ordered-census-required`);
        const allowed =
          expected === "id-token"
            ? ["NONE", "WRITE"]
            : expected === "models" || expected === "vulnerability-alerts"
              ? ["NONE", "READ"]
              : ["NONE", "READ", "WRITE"];
        if (!allowed.includes(permission.access as string)) issues.push(`${pp}.access:invalid`);
      });
    validateTrigger(row.trigger, row.role, `${p}.trigger`, issues);
    rows.push(row);
  });
  if (rows.length === 2) {
    if (
      typeof rows[0]!.path === "string" &&
      typeof rows[1]!.path === "string" &&
      byteCompare(rows[0]!.path, rows[1]!.path) >= 0
    )
      issues.push(`${prefix}:order-or-duplicate`);
    const build = rows.find((row) => row.role === "BUILD");
    const review = rows.find((row) => row.role === "REVIEW");
    if (!build || !review) issues.push(`${prefix}:role-census-required`);
    else {
      const trigger = review.trigger as ContractRecord;
      if (trigger.sourceWorkflowDigest !== build.digest)
        issues.push(`${prefix}:review-source-digest-mismatch`);
      if (trigger.sourceWorkflowPath !== build.path)
        issues.push(`${prefix}:review-source-path-mismatch`);
      if (trigger.sourceWorkflowRef !== build.ref)
        issues.push(`${prefix}:review-source-ref-mismatch`);
    }
  }
  return rows;
}
function validateRequest(
  value: JsonValue | undefined,
  prefix: string,
  issues: string[],
): ContractRecord | null {
  const snapshot = snapshotJson(value);
  if (!snapshot.ok) {
    issues.push(...snapshot.issues.map((issue) => `${prefix}.${issue}`));
    return null;
  }
  if (
    snapshot.value === null ||
    Array.isArray(snapshot.value) ||
    typeof snapshot.value !== "object"
  ) {
    issues.push(`${prefix}.record:object-required`);
    return null;
  }
  const detached = snapshot.value as ContractRecord;
  const kind = detached.apiKind;
  const fields =
    kind === "REST"
      ? repositoryProtectionSchemaFields.restRequest
      : kind === "GRAPHQL"
        ? repositoryProtectionSchemaFields.graphqlRequest
        : [];
  if (fields.length === 0) {
    issues.push(`${prefix}.apiKind:invalid`);
    return null;
  }
  const row = nestedRecord(detached, fields, prefix, issues);
  if (!row) return null;
  if (kind === "REST") {
    if (row.apiVersion !== "2022-11-28") issues.push(`${prefix}.apiVersion:mismatch`);
    if (row.method !== "GET") issues.push(`${prefix}.method:mismatch`);
    if (!digest(row.queryDigest)) issues.push(`${prefix}.queryDigest:invalid`);
    if (!route(row.route)) issues.push(`${prefix}.route:invalid`);
  } else {
    if (row.apiVersion !== null) issues.push(`${prefix}.apiVersion:null-required`);
    if (row.method !== "POST") issues.push(`${prefix}.method:mismatch`);
    if (!digest(row.documentDigest)) issues.push(`${prefix}.documentDigest:invalid`);
    if (!digest(row.variablesDigest)) issues.push(`${prefix}.variablesDigest:invalid`);
  }
  return row;
}
function validateCommonPage(
  row: ContractRecord,
  expectedOrdinal: number,
  prefix: string,
  issues: string[],
): void {
  if (row.ordinal !== String(expectedOrdinal)) issues.push(`${prefix}.ordinal:mismatch`);
  if (row.status !== "200") issues.push(`${prefix}.status:mismatch`);
  if (!digest(row.requestDigest)) issues.push(`${prefix}.requestDigest:invalid`);
  if (!digest(row.responseDigest)) issues.push(`${prefix}.responseDigest:invalid`);
  if (!timestamp(row.observedAt)) issues.push(`${prefix}.observedAt:invalid`);
}
function validateRestPages(
  value: JsonValue | undefined,
  prefix: string,
  issues: string[],
): readonly ContractRecord[] | null {
  const values = nestedArray(value, 1, 64, prefix, issues);
  if (!values) return null;
  const pages: ContractRecord[] = [];
  values.forEach((value, index) => {
    const p = `${prefix}.${index}`;
    const row = nestedRecord(value, repositoryProtectionSchemaFields.restPage, p, issues);
    if (!row) return;
    validateCommonPage(row, index + 1, p, issues);
    if (!etag(row.etag)) issues.push(`${p}.etag:invalid`);
    if (row.linkHeaderDigest !== null && !digest(row.linkHeaderDigest))
      issues.push(`${p}.linkHeaderDigest:invalid`);
    if (row.nextRequestDigest !== null && !digest(row.nextRequestDigest))
      issues.push(`${p}.nextRequestDigest:invalid`);
    const relations = nestedArray(row.linkRelations, 0, 4, `${p}.linkRelations`, issues);
    const parsedRelations: ContractRecord[] = [];
    if (relations)
      relations.forEach((value, relationIndex) => {
        const rp = `${p}.linkRelations.${relationIndex}`;
        const relation = nestedRecord(
          value,
          repositoryProtectionSchemaFields.linkRelation,
          rp,
          issues,
        );
        if (!relation) return;
        if (!["FIRST", "LAST", "NEXT", "PREV"].includes(relation.relation as string))
          issues.push(`${rp}.relation:invalid`);
        if (!digest(relation.targetRequestDigest)) issues.push(`${rp}.targetRequestDigest:invalid`);
        parsedRelations.push(relation);
      });
    for (let r = 1; r < parsedRelations.length; r += 1)
      if (
        byteCompare(
          parsedRelations[r - 1]!.relation as string,
          parsedRelations[r]!.relation as string,
        ) >= 0
      )
        issues.push(`${p}.linkRelations:order-or-duplicate`);
    if ((parsedRelations.length === 0) !== (row.linkHeaderDigest === null))
      issues.push(`${p}.linkHeaderDigest:nullability`);
    pages.push(row);
  });
  const requests = pages.map((page) => page.requestDigest);
  if (new Set(requests).size !== requests.length) issues.push(`${prefix}:requestDigest-duplicate`);
  const nextTargets: string[] = [];
  pages.forEach((page, index) => {
    const relations = page.linkRelations as readonly ContractRecord[];
    const relation = (name: string) => relations.find((row) => row.relation === name);
    const last = pages.length - 1;
    const expected: Readonly<Record<string, string | null>> = {
      FIRST: index > 0 ? (pages[0]!.requestDigest as string) : null,
      PREV: index > 0 ? (pages[index - 1]!.requestDigest as string) : null,
      NEXT: index < last ? (pages[index + 1]!.requestDigest as string) : null,
      LAST: index < last ? (pages[last]!.requestDigest as string) : null,
    };
    for (const name of ["FIRST", "PREV", "NEXT", "LAST"] as const) {
      const row = relation(name);
      if (row && row.targetRequestDigest !== expected[name])
        issues.push(`${prefix}.${index}.linkRelations.${name}:target-mismatch`);
      if (expected[name] === null && row)
        issues.push(`${prefix}.${index}.linkRelations.${name}:boundary-forbidden`);
    }
    const next = relation("NEXT");
    if (index < last) {
      if (!next) issues.push(`${prefix}.${index}.linkRelations.NEXT:required`);
      if (page.nextRequestDigest !== expected.NEXT)
        issues.push(`${prefix}.${index}.nextRequestDigest:mismatch`);
      if (typeof page.nextRequestDigest === "string") nextTargets.push(page.nextRequestDigest);
    } else if (page.nextRequestDigest !== null)
      issues.push(`${prefix}.${index}.nextRequestDigest:null-required`);
  });
  if (new Set(nextTargets).size !== nextTargets.length)
    issues.push(`${prefix}:next-target-duplicate`);
  return pages;
}
function validateGraphqlPages(
  value: JsonValue | undefined,
  prefix: string,
  issues: string[],
): readonly ContractRecord[] | null {
  const values = nestedArray(value, 1, 64, prefix, issues);
  if (!values) return null;
  const pages: ContractRecord[] = [];
  values.forEach((value, index) => {
    const p = `${prefix}.${index}`;
    const row = nestedRecord(value, repositoryProtectionSchemaFields.graphqlPage, p, issues);
    if (!row) return;
    validateCommonPage(row, index + 1, p, issues);
    if (row.etag !== null && !etag(row.etag)) issues.push(`${p}.etag:invalid`);
    for (const field of ["requestCursor", "endCursor"] as const)
      if (row[field] !== null && !cursor(row[field])) issues.push(`${p}.${field}:invalid`);
    if (typeof row.hasNextPage !== "boolean") issues.push(`${p}.hasNextPage:invalid`);
    pages.push(row);
  });
  const requests = pages.map((page) => page.requestDigest);
  if (new Set(requests).size !== requests.length) issues.push(`${prefix}:requestDigest-duplicate`);
  const seenCursors = new Set<string>();
  pages.forEach((page, index) => {
    const final = index === pages.length - 1;
    if (index === 0 && page.requestCursor !== null)
      issues.push(`${prefix}.0.requestCursor:null-required`);
    if (index > 0 && page.requestCursor !== pages[index - 1]!.endCursor)
      issues.push(`${prefix}.${index}.requestCursor:mismatch`);
    if (page.requestCursor !== null) {
      if (seenCursors.has(page.requestCursor as string))
        issues.push(`${prefix}.${index}.requestCursor:repeated`);
      seenCursors.add(page.requestCursor as string);
    }
    if (page.endCursor !== null && seenCursors.has(page.endCursor as string))
      issues.push(`${prefix}.${index}.endCursor:repeated`);
    if (final) {
      if (page.hasNextPage !== false) issues.push(`${prefix}.${index}.hasNextPage:false-required`);
    } else {
      if (page.hasNextPage !== true) issues.push(`${prefix}.${index}.hasNextPage:true-required`);
      if (page.endCursor === null) issues.push(`${prefix}.${index}.endCursor:required`);
    }
  });
  return pages;
}

function requestIdentityRaw(purpose: Purpose, request: ContractRecord): string {
  return framedDigest("github-api-request-identity/v1", [
    frame.text(purpose),
    frame.canonical(request),
  ]);
}
function pageRequestRaw(requestIdentityDigest: string, requestCursor: string | null): string {
  return framedDigest("github-api-page-request/v1", [
    frame.raw32(requestIdentityDigest),
    frame.nullableText(requestCursor),
  ]);
}
function completeReductionRaw(
  requestIdentityDigest: string,
  pages: readonly ContractRecord[],
  reducedValueDigest: string,
): string {
  return framedDigest("github-api-complete-reduction/v1", [
    frame.raw32(requestIdentityDigest),
    frame.canonical(
      pages.map(({ ordinal, responseDigest }) => ({
        ordinal: ordinal!,
        responseDigest: responseDigest!,
      })) as JsonValue,
    ),
    frame.raw32(reducedValueDigest),
  ]);
}
function terminalPaginationRaw(
  requestIdentityDigest: string,
  apiKind: ApiKind,
  pages: readonly ContractRecord[],
): string {
  return framedDigest("github-api-terminal-pagination/v1", [
    frame.raw32(requestIdentityDigest),
    frame.text(apiKind),
    frame.canonical(pages),
  ]);
}
function reducedValueRaw(purpose: Purpose, projection: ContractRecord): string {
  return framedDigest("github-api-reduced-value/v1", [
    frame.text(purpose),
    frame.canonical(projection),
  ]);
}

/** Computes the closed request identity; request-material hashes remain supplied opaque claims. */
export function computeGitHubApiRequestIdentityDigest(purpose: unknown, request: unknown): string {
  const issues: string[] = [];
  if (!inPurpose(purpose as JsonValue)) throw new TypeError("purpose:invalid");
  const parsed = validateRequest(request as JsonValue, "request", issues);
  if (!parsed || issues.length) throw new TypeError([...new Set(issues)].sort().join(","));
  return requestIdentityRaw(purpose as Purpose, parsed);
}
export function computeGitHubApiPageRequestDigest(
  requestIdentityDigest: unknown,
  requestCursor: unknown,
): string {
  if (!digest(requestIdentityDigest as JsonValue))
    throw new TypeError("requestIdentityDigest:invalid");
  if (requestCursor !== null && !cursor(requestCursor as JsonValue))
    throw new TypeError("requestCursor:invalid");
  return pageRequestRaw(requestIdentityDigest as string, requestCursor as string | null);
}
export function computeGitHubApiCompleteReductionDigest(
  requestIdentityDigest: unknown,
  pages: unknown,
  reducedValueDigest: unknown,
): string {
  if (!digest(requestIdentityDigest as JsonValue) || !digest(reducedValueDigest as JsonValue))
    throw new TypeError("digest:invalid");
  const issues: string[] = [];
  const values = nestedArray(pages as JsonValue, 1, 64, "pages", issues);
  const rows: ContractRecord[] = [];
  values?.forEach((value, index) => {
    const row = nestedRecord(
      value,
      repositoryProtectionSchemaFields.completeReductionPage,
      `pages.${index}`,
      issues,
    );
    if (!row) return;
    if (row.ordinal !== String(index + 1)) issues.push(`pages.${index}.ordinal:mismatch`);
    if (!digest(row.responseDigest)) issues.push(`pages.${index}.responseDigest:invalid`);
    rows.push(row);
  });
  if (!values || issues.length) throw new TypeError([...new Set(issues)].sort().join(","));
  return completeReductionRaw(requestIdentityDigest as string, rows, reducedValueDigest as string);
}
export function computeGitHubApiTerminalPaginationDigest(
  requestIdentityDigest: unknown,
  apiKind: unknown,
  pages: unknown,
): string {
  if (!digest(requestIdentityDigest as JsonValue))
    throw new TypeError("requestIdentityDigest:invalid");
  if (apiKind !== "REST" && apiKind !== "GRAPHQL") throw new TypeError("apiKind:invalid");
  const issues: string[] = [];
  const parsed =
    apiKind === "REST"
      ? validateRestPages(pages as JsonValue, "pages", issues)
      : validateGraphqlPages(pages as JsonValue, "pages", issues);
  if (!parsed || issues.length) throw new TypeError([...new Set(issues)].sort().join(","));
  return terminalPaginationRaw(requestIdentityDigest as string, apiKind, parsed);
}

function validateTriggeringBuild(
  value: JsonValue | undefined,
  prefix: string,
  issues: string[],
): ContractRecord | null {
  const row = nestedRecord(value, repositoryProtectionSchemaFields.triggeringBuild, prefix, issues);
  if (!row) return null;
  if (!timestamp(row.completedAt)) issues.push(`${prefix}.completedAt:invalid`);
  if (row.conclusion !== "SUCCESS") issues.push(`${prefix}.conclusion:mismatch`);
  for (const field of ["runAttempt", "runId"] as const)
    if (!positiveId(row[field])) issues.push(`${prefix}.${field}:invalid`);
  if (!digest(row.workflowDigest)) issues.push(`${prefix}.workflowDigest:invalid`);
  if (!path(row.workflowPath)) issues.push(`${prefix}.workflowPath:invalid`);
  if (!branchRef(row.workflowRef)) issues.push(`${prefix}.workflowRef:invalid`);
  return row;
}
function projectionFor(
  purpose: Purpose,
  receipt: ContractRecord,
  triggeringBuild: ContractRecord | null,
): ContractRecord | null {
  const environment = receipt.environmentBinding as ContractRecord;
  const workflows = receipt.workflows as readonly ContractRecord[];
  const workflow = (role: string) => workflows.find((row) => row.role === role)!;
  if (purpose === "ENVIRONMENT") return { environmentName: environment.environmentName! };
  if (purpose === "ENVIRONMENT_VARIABLE")
    return {
      environmentName: environment.environmentName!,
      variableName: environment.variableName!,
      variableValue: environment.variableValue!,
    };
  if (purpose === "REPOSITORY") return { repositoryId: receipt.repositoryId! };
  if (purpose === "RULESET")
    return {
      protectedPathPolicies: receipt.protectedPathPolicies!,
      reviewPolicy: receipt.reviewPolicy!,
      rulesetId: receipt.rulesetId!,
    };
  if (purpose === "WORKFLOW_BUILD") return { workflow: workflow("BUILD") };
  if (purpose === "WORKFLOW_REVIEW") return { workflow: workflow("REVIEW") };
  if (purpose === "WORKFLOW_RUN") return triggeringBuild ? { triggeringBuild } : null;
  return null;
}
function rulesetSemanticRaw(receipt: ContractRecord): string {
  return framedDigest("repository-protection-ruleset-semantics/v1", [
    frame.canonical({
      protectedPathPolicies: receipt.protectedPathPolicies!,
      repositoryId: receipt.repositoryId!,
      reviewPolicy: receipt.reviewPolicy!,
      rulesetId: receipt.rulesetId!,
      workflows: receipt.workflows!,
    }),
  ]);
}

/** Validates a detached historical receipt. Opaque leaves do not prove API origin or completeness. */
export function parseRepositoryProtectionReceipt(
  input: unknown,
): ParseResult<RepositoryProtectionReceipt> {
  const snapshot = snapshotClosedRecord(input, repositoryProtectionSchemaFields.receipt);
  if (!snapshot.ok) return snapshot;
  const receipt = snapshot.value;
  const issues: string[] = [];
  if (receipt.schemaVersion !== "repository-protection-receipt/v1")
    issues.push("schemaVersion:mismatch");
  if (!["ACCEPTED", "REJECTED", "BLOCK_REPLAN"].includes(receipt.disposition as string))
    issues.push("disposition:invalid");
  for (const field of ["repositoryId", "rulesetId"] as const)
    if (!positiveId(receipt[field])) issues.push(`${field}:invalid`);
  for (const field of ["rulesetSemanticDigest", "verifierAnchorDigest"] as const)
    if (!digest(receipt[field])) issues.push(`${field}:invalid`);
  for (const field of ["issuedAt", "expiresAt"] as const)
    if (!timestamp(receipt[field])) issues.push(`${field}:invalid`);
  if (timestamp(receipt.issuedAt) && timestamp(receipt.expiresAt)) {
    const elapsed = Date.parse(receipt.expiresAt) - Date.parse(receipt.issuedAt);
    if (elapsed <= 0) issues.push("expiresAt:not-after-issuedAt");
    if (elapsed > 604_800_000) issues.push("expiresAt:more-than-seven-days");
  }
  validateReviewPolicy(receipt.reviewPolicy, "reviewPolicy", issues);
  validateProtectedPaths(receipt.protectedPathPolicies, "protectedPathPolicies", issues);
  const workflows = validateWorkflows(receipt.workflows, "workflows", issues);
  const producer = nestedRecord(
    receipt.producer,
    repositoryProtectionSchemaFields.producer,
    "producer",
    issues,
  );
  if (producer) {
    if (!safeName(producer.artifactName)) issues.push("producer.artifactName:invalid");
    for (const field of ["runAttempt", "runId"] as const)
      if (!positiveId(producer[field])) issues.push(`producer.${field}:invalid`);
    if (!timestamp(producer.startedAt)) issues.push("producer.startedAt:invalid");
    if (!digest(producer.workflowDigest)) issues.push("producer.workflowDigest:invalid");
    if (!path(producer.workflowPath)) issues.push("producer.workflowPath:invalid");
    if (!branchRef(producer.workflowRef)) issues.push("producer.workflowRef:invalid");
    const review = workflows?.find((row) => row.role === "REVIEW");
    if (review)
      for (const field of ["workflowDigest", "workflowPath", "workflowRef"] as const)
        if (
          producer[field] !==
          review[field.slice("workflow".length).replace(/^./, (c) => c.toLowerCase())]
        )
          issues.push(`producer.${field}:review-mismatch`);
  }
  const environment = nestedRecord(
    receipt.environmentBinding,
    repositoryProtectionSchemaFields.environmentBinding,
    "environmentBinding",
    issues,
  );
  if (environment) {
    if (!etag(environment.environmentEtag))
      issues.push("environmentBinding.environmentEtag:invalid");
    if (environment.environmentName !== "host-custody-bootstrap-root")
      issues.push("environmentBinding.environmentName:mismatch");
    if (environment.variableName !== "VERIFIER_ANCHOR_SHA256")
      issues.push("environmentBinding.variableName:mismatch");
    if (!timestamp(environment.variableUpdatedAt))
      issues.push("environmentBinding.variableUpdatedAt:invalid");
    if (!digest(environment.variableValue)) issues.push("environmentBinding.variableValue:invalid");
    if (environment.variableValue !== receipt.verifierAnchorDigest)
      issues.push("environmentBinding.variableValue:anchor-mismatch");
    if (
      timestamp(environment.variableUpdatedAt) &&
      producer &&
      timestamp(producer.startedAt) &&
      environment.variableUpdatedAt >= producer.startedAt
    )
      issues.push("environmentBinding.variableUpdatedAt:not-before-producer");
  }
  if (
    producer &&
    timestamp(producer.startedAt) &&
    timestamp(receipt.issuedAt) &&
    producer.startedAt > receipt.issuedAt
  )
    issues.push("producer.startedAt:after-issuedAt");

  const observations = nestedArray(receipt.apiObservations, 9, 9, "apiObservations", issues);
  const parsedObservations: ContractRecord[] = [];
  observations?.forEach((value, index) => {
    const p = `apiObservations.${index}`;
    const row = nestedRecord(value, repositoryProtectionSchemaFields.observation, p, issues);
    if (!row) return;
    const expectedPurpose = repositoryProtectionPurposes[index]!;
    if (row.purpose !== expectedPurpose) issues.push(`${p}.purpose:ordered-census-required`);
    const purpose = inPurpose(row.purpose) ? row.purpose : expectedPurpose;
    for (const field of [
      "requestIdentityDigest",
      "reducedValueDigest",
      "completeReductionDigest",
      "terminalPaginationDigest",
    ] as const)
      if (!digest(row[field])) issues.push(`${p}.${field}:invalid`);
    for (const field of ["startedAt", "completedAt"] as const)
      if (!timestamp(row[field])) issues.push(`${p}.${field}:invalid`);
    if (timestamp(row.startedAt) && timestamp(row.completedAt) && row.startedAt > row.completedAt)
      issues.push(`${p}:time-order`);
    const request = validateRequest(row.request, `${p}.request`, issues);
    const pages =
      request?.apiKind === "REST"
        ? validateRestPages(row.pages, `${p}.pages`, issues)
        : request?.apiKind === "GRAPHQL"
          ? validateGraphqlPages(row.pages, `${p}.pages`, issues)
          : null;
    let triggeringBuild: ContractRecord | null = null;
    if (purpose === "WORKFLOW_RUN") {
      if (row.triggeringBuild === null) issues.push(`${p}.triggeringBuild:required`);
      else
        triggeringBuild = validateTriggeringBuild(
          row.triggeringBuild,
          `${p}.triggeringBuild`,
          issues,
        );
    } else if (row.triggeringBuild !== null) issues.push(`${p}.triggeringBuild:null-required`);
    if (request && digest(row.requestIdentityDigest)) {
      const expected = requestIdentityRaw(purpose, request);
      if (row.requestIdentityDigest !== expected)
        issues.push(`${p}.requestIdentityDigest:mismatch`);
      if (pages?.length) {
        if (pages[0]!.requestDigest !== pageRequestRaw(expected, null))
          issues.push(`${p}.pages.0.requestDigest:mismatch`);
        if (request.apiKind === "GRAPHQL")
          pages.forEach((page, pageIndex) => {
            if (
              page.requestDigest !== pageRequestRaw(expected, page.requestCursor as string | null)
            )
              issues.push(`${p}.pages.${pageIndex}.requestDigest:mismatch`);
          });
        if (
          digest(row.reducedValueDigest) &&
          row.completeReductionDigest !==
            completeReductionRaw(expected, pages, row.reducedValueDigest)
        )
          issues.push(`${p}.completeReductionDigest:mismatch`);
        if (
          row.terminalPaginationDigest !==
          terminalPaginationRaw(expected, request.apiKind as ApiKind, pages)
        )
          issues.push(`${p}.terminalPaginationDigest:mismatch`);
      }
    }
    const projection = projectionFor(purpose, receipt, triggeringBuild);
    if (projection && row.reducedValueDigest !== reducedValueRaw(purpose, projection))
      issues.push(`${p}.reducedValueDigest:mismatch`);
    if (
      pages &&
      producer &&
      timestamp(producer.startedAt) &&
      timestamp(row.startedAt) &&
      timestamp(row.completedAt) &&
      timestamp(receipt.issuedAt)
    ) {
      const startedAt = row.startedAt as string;
      const completedAt = row.completedAt as string;
      if (producer.startedAt > startedAt) issues.push(`${p}.startedAt:before-producer`);
      if (completedAt > receipt.issuedAt) issues.push(`${p}.completedAt:after-issuedAt`);
      pages.forEach((page, pageIndex) => {
        if (
          timestamp(page.observedAt) &&
          (page.observedAt < startedAt || page.observedAt > completedAt)
        )
          issues.push(`${p}.pages.${pageIndex}.observedAt:outside-observation`);
      });
    }
    parsedObservations.push(row);
  });
  if (
    new Set(parsedObservations.map((row) => row.requestIdentityDigest)).size !==
    parsedObservations.length
  )
    issues.push("apiObservations:requestIdentityDigest-duplicate");
  const workflowRun = parsedObservations.find((row) => row.purpose === "WORKFLOW_RUN");
  const triggering = workflowRun?.triggeringBuild as ContractRecord | null | undefined;
  const build = workflows?.find((row) => row.role === "BUILD");
  if (triggering && build) {
    if (triggering.workflowDigest !== build.digest)
      issues.push("apiObservations.WORKFLOW_RUN.triggeringBuild.workflowDigest:mismatch");
    if (triggering.workflowPath !== build.path)
      issues.push("apiObservations.WORKFLOW_RUN.triggeringBuild.workflowPath:mismatch");
    if (triggering.workflowRef !== build.ref)
      issues.push("apiObservations.WORKFLOW_RUN.triggeringBuild.workflowRef:mismatch");
    if (producer && triggering.runId === producer.runId)
      issues.push("producer.runId:triggering-build-alias");
    if (
      producer &&
      timestamp(triggering.completedAt) &&
      timestamp(producer.startedAt) &&
      triggering.completedAt > producer.startedAt
    )
      issues.push("apiObservations.WORKFLOW_RUN.triggeringBuild.completedAt:after-producer-start");
  }
  if (
    environment &&
    timestamp(environment.variableUpdatedAt) &&
    timestamp(receipt.issuedAt) &&
    environment.variableUpdatedAt > receipt.issuedAt
  )
    issues.push("environmentBinding.variableUpdatedAt:after-issuedAt");
  if (receipt.rulesetSemanticDigest !== rulesetSemanticRaw(receipt))
    issues.push("rulesetSemanticDigest:mismatch");
  return issues.length
    ? fail(...issues)
    : { ok: true, value: receipt as RepositoryProtectionReceipt };
}

export function computeRepositoryProtectionRulesetSemanticDigest(input: unknown): string {
  const fields = repositoryProtectionSchemaFields.rulesetSemantics;
  const snapshot = snapshotClosedRecord(input, fields);
  if (!snapshot.ok) throw new TypeError(snapshot.issues.join(","));
  const issues: string[] = [];
  if (!positiveId(snapshot.value.repositoryId)) issues.push("repositoryId:invalid");
  if (!positiveId(snapshot.value.rulesetId)) issues.push("rulesetId:invalid");
  validateReviewPolicy(snapshot.value.reviewPolicy, "reviewPolicy", issues);
  validateProtectedPaths(snapshot.value.protectedPathPolicies, "protectedPathPolicies", issues);
  validateWorkflows(snapshot.value.workflows, "workflows", issues);
  if (issues.length) throw new TypeError([...new Set(issues)].sort().join(","));
  return rulesetSemanticRaw(snapshot.value);
}
export function computeRepositoryProtectionReceiptDigest(input: unknown): string {
  const parsed = parseRepositoryProtectionReceipt(input);
  if (!parsed.ok) throw new TypeError(parsed.issues.join(","));
  return framedDigest("repository-protection-receipt/v1", [frame.canonical(parsed.value)]);
}
export function parseRepositoryProtectionContract(
  schemaVersion: string,
  input: unknown,
): ParseResult | null {
  return schemaVersion === "repository-protection-receipt/v1"
    ? parseRepositoryProtectionReceipt(input)
    : null;
}

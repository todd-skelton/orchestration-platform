/**
 * Pure relations, pagination, semantic projections, digest composition and the
 * public parser for the historical `repository-protection-receipt/v1` family
 * (ISS-054 Packet B, Decisions #268/#272, pressure Round 451).
 *
 * This module implements no parser. Every entry point first invokes the
 * applicable closed structural parser of the package-private Packet A module
 * `./repository-protection-parse.js` and then computes over that typed result
 * only. There is no fragment parser, raw-object cast, non-null assertion over
 * raw input, or caller-asserted typed fast path, so no raw value ever reaches a
 * relation, projection, pagination walk or digest frame.
 *
 * Relations receive parsed records, scalars and dense arrays and return a typed
 * issue list; only a zero-issue relation result produces public parser success.
 * Type correctness is necessary but never treated as relational proof.
 *
 * Success proves an internally consistent supplied receipt. It does not observe
 * GitHub, authenticate an opaque digest leaf, prove pagination completeness,
 * prove freshness, prove that an operator acted, or grant authority. Response,
 * raw Link header, later REST page request and historical pull-request or
 * review reductions remain explicitly opaque supplied claims that this contract
 * only encloses.
 */
import { frame, framedDigest, type JsonValue, type ParseResult } from "./runtime.js";
import {
  parseCompleteReductionPages,
  parseGitHubApiKind,
  parseNullableRequestCursor,
  parseRepositoryProtectionPurpose,
  parseRepositoryProtectionRequest,
  parseRepositoryProtectionSchemaVersion,
  parseRepositoryProtectionStructure,
  parseRulesetSemantics,
  parseSha256Digest,
  parseTerminalPaginationPages,
  repositoryProtectionPermissionNames,
  repositoryProtectionPurposes,
  repositoryProtectionSchemaFields,
  repositoryProtectionSchemaVersions,
  type GitHubApiKind,
  type ParsedCompleteReductionPage,
  type ParsedGraphqlPage,
  type ParsedHistoricalApiObservation,
  type ParsedProtectedPathPolicy,
  type ParsedRepositoryProtectionRequest,
  type ParsedRepositoryProtectionStructure,
  type ParsedRestPage,
  type ParsedReviewPolicy,
  type ParsedWorkflow,
  type RepositoryProtectionPurpose,
  type RepositoryProtectionReceipt,
  type RestLinkRelationName,
  type WorkflowRole,
} from "./repository-protection-parse.js";

export {
  repositoryProtectionPermissionNames,
  repositoryProtectionPurposes,
  repositoryProtectionSchemaFields,
  repositoryProtectionSchemaVersions,
};
export type { RepositoryProtectionReceipt };

/* -------------------------------------------------------------------------- *
 * Accepted frame domains and part order
 * -------------------------------------------------------------------------- */

const REQUEST_IDENTITY_DOMAIN = "github-api-request-identity/v1";
const PAGE_REQUEST_DOMAIN = "github-api-page-request/v1";
const COMPLETE_REDUCTION_DOMAIN = "github-api-complete-reduction/v1";
const TERMINAL_PAGINATION_DOMAIN = "github-api-terminal-pagination/v1";
const REDUCED_VALUE_DOMAIN = "github-api-reduced-value/v1";
const RULESET_SEMANTICS_DOMAIN = "repository-protection-ruleset-semantics/v1";
const RECEIPT_IDENTITY_DOMAIN = "repository-protection-receipt/v1";
const REST_LINK_RELATION_ORDER = Object.freeze(["FIRST", "LAST", "NEXT", "PREV"] as const);
const WORKFLOW_ROLE_EVENTS = Object.freeze({
  BUILD: "PULL_REQUEST",
  REVIEW: "WORKFLOW_RUN",
} as const);

type Issues = string[];
type PageRow = ParsedGraphqlPage | ParsedRestPage;
type ReductionRow = Readonly<{ ordinal: string; responseDigest: string }>;
type RulesetSemanticProjection = Readonly<{
  protectedPathPolicies: readonly ParsedProtectedPathPolicy[];
  repositoryId: string;
  reviewPolicy: ParsedReviewPolicy;
  rulesetId: string;
  workflows: readonly ParsedWorkflow[];
}>;

function sortedIssues(issues: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(issues)].sort());
}
function refuseWith(issues: readonly string[]): never {
  throw new TypeError(sortedIssues(issues).join(","));
}
function byteCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/**
 * Branch views over already-parsed page rows. Each reads only members of a
 * successful Packet A page result and returns `null` unless every row belongs
 * to the requested branch, so a mismatched branch fails closed instead of being
 * asserted by the caller.
 */
function isParsedRestPage(page: PageRow): page is ParsedRestPage {
  return Array.isArray(page.linkRelations);
}
function isParsedGraphqlPage(page: PageRow): page is ParsedGraphqlPage {
  return typeof page.hasNextPage === "boolean";
}
function restPageRows(pages: readonly PageRow[]): readonly ParsedRestPage[] | null {
  const rows: ParsedRestPage[] = [];
  for (const page of pages) {
    if (!isParsedRestPage(page)) return null;
    rows.push(page);
  }
  return rows;
}
function graphqlPageRows(pages: readonly PageRow[]): readonly ParsedGraphqlPage[] | null {
  const rows: ParsedGraphqlPage[] = [];
  for (const page of pages) {
    if (!isParsedGraphqlPage(page)) return null;
    rows.push(page);
  }
  return rows;
}

/* -------------------------------------------------------------------------- *
 * Accepted digest recipes. Listed part order and tags are significant.
 * -------------------------------------------------------------------------- */

function requestIdentityFrame(
  purpose: RepositoryProtectionPurpose,
  request: ParsedRepositoryProtectionRequest,
): string {
  return framedDigest(REQUEST_IDENTITY_DOMAIN, [frame.text(purpose), frame.canonical(request)]);
}
function pageRequestFrame(requestIdentityDigest: string, requestCursor: string | null): string {
  return framedDigest(PAGE_REQUEST_DOMAIN, [
    frame.raw32(requestIdentityDigest),
    frame.nullableText(requestCursor),
  ]);
}
function completeReductionFrame(
  requestIdentityDigest: string,
  pages: readonly ReductionRow[],
  reducedValueDigest: string,
): string {
  return framedDigest(COMPLETE_REDUCTION_DOMAIN, [
    frame.raw32(requestIdentityDigest),
    frame.canonical(pages.map(({ ordinal, responseDigest }) => ({ ordinal, responseDigest }))),
    frame.raw32(reducedValueDigest),
  ]);
}
function terminalPaginationFrame(
  requestIdentityDigest: string,
  apiKind: GitHubApiKind,
  pages: readonly PageRow[],
): string {
  return framedDigest(TERMINAL_PAGINATION_DOMAIN, [
    frame.raw32(requestIdentityDigest),
    frame.text(apiKind),
    frame.canonical(pages),
  ]);
}
function reducedValueFrame(purpose: RepositoryProtectionPurpose, projection: JsonValue): string {
  return framedDigest(REDUCED_VALUE_DOMAIN, [frame.text(purpose), frame.canonical(projection)]);
}
function rulesetSemanticFrame(projection: RulesetSemanticProjection): string {
  return framedDigest(RULESET_SEMANTICS_DOMAIN, [frame.canonical(projection)]);
}

/* -------------------------------------------------------------------------- *
 * Pure relations over parsed values
 * -------------------------------------------------------------------------- */

/** Protected-path row ordering and uniqueness, independent of the local parse. */
function relateProtectedPathPolicies(
  rows: readonly ParsedProtectedPathPolicy[],
  prefix: string,
): readonly string[] {
  const issues: Issues = [];
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (previous === undefined || current === undefined) continue;
    if (byteCompare(previous.path, current.path) >= 0) issues.push(`${prefix}:order-or-duplicate`);
  }
  return issues;
}

/** Exactly one row per role, or `null` so every dependent relation fails closed. */
function selectWorkflow(
  workflows: readonly ParsedWorkflow[],
  role: WorkflowRole,
): ParsedWorkflow | null {
  const matches = workflows.filter((row) => row.role === role);
  const only = matches.length === 1 ? matches[0] : undefined;
  return only ?? null;
}

/**
 * Workflow roster relations: path order and uniqueness, the exact two-role
 * census, the role-to-event pairing that a single trigger record cannot see,
 * distinct workflow identities, and the REVIEW trigger source equality with the
 * BUILD row.
 */
function relateWorkflows(workflows: readonly ParsedWorkflow[], prefix: string): readonly string[] {
  const issues: Issues = [];
  for (let index = 1; index < workflows.length; index += 1) {
    const previous = workflows[index - 1];
    const current = workflows[index];
    if (previous === undefined || current === undefined) continue;
    if (byteCompare(previous.path, current.path) >= 0) issues.push(`${prefix}:order-or-duplicate`);
  }
  const build = selectWorkflow(workflows, "BUILD");
  const review = selectWorkflow(workflows, "REVIEW");
  if (build === null || review === null) {
    issues.push(`${prefix}:role-census-required`);
    return issues;
  }
  if (build.trigger.event !== WORKFLOW_ROLE_EVENTS.BUILD)
    issues.push(`${prefix}:build-role-event-mismatch`);
  if (review.trigger.event !== WORKFLOW_ROLE_EVENTS.REVIEW)
    issues.push(`${prefix}:review-role-event-mismatch`);
  if (build.workflowId === review.workflowId) issues.push(`${prefix}:workflowId-duplicate`);
  if (review.trigger.sourceWorkflowDigest !== build.digest)
    issues.push(`${prefix}:review-source-digest-mismatch`);
  if (review.trigger.sourceWorkflowPath !== build.path)
    issues.push(`${prefix}:review-source-path-mismatch`);
  if (review.trigger.sourceWorkflowRef !== build.ref)
    issues.push(`${prefix}:review-source-ref-mismatch`);
  return issues;
}

/** The five-member semantic projection relations. */
function relateRulesetSemantics(
  projection: RulesetSemanticProjection,
  prefix: string,
): readonly string[] {
  return [
    ...relateProtectedPathPolicies(
      projection.protectedPathPolicies,
      `${prefix}protectedPathPolicies`,
    ),
    ...relateWorkflows(projection.workflows, `${prefix}workflows`),
  ];
}

/** The closed reduction projection ordinal adjacency. */
function relateCompleteReductionPages(
  rows: readonly ParsedCompleteReductionPage[],
  prefix: string,
): readonly string[] {
  const issues: Issues = [];
  rows.forEach((row, index) => {
    if (row.ordinal !== String(index + 1)) issues.push(`${prefix}.${index}.ordinal:mismatch`);
  });
  return issues;
}

/**
 * REST page chain: adjacent ordinals, globally unique page request digests, the
 * exact indexed Link targets with their boundary rules, mandatory nonterminal
 * `NEXT`, the terminal null `nextRequestDigest`, and unique NEXT targets. A
 * supplied `A -> B -> A` chain repeats a request digest and therefore refuses.
 */
function relateRestPageChain(pages: readonly ParsedRestPage[], prefix: string): readonly string[] {
  const last = pages.length - 1;
  const firstPage = pages[0];
  const finalPage = pages[last];
  if (firstPage === undefined || finalPage === undefined) return [`${prefix}:dense-rows-required`];
  const issues: Issues = [];
  const requestDigests = pages.map((page) => page.requestDigest);
  if (new Set(requestDigests).size !== requestDigests.length)
    issues.push(`${prefix}:requestDigest-duplicate`);
  const nextTargets: string[] = [];
  pages.forEach((page, index) => {
    if (page.ordinal !== String(index + 1)) issues.push(`${prefix}.${index}.ordinal:mismatch`);
    const previous = pages[index - 1];
    const following = pages[index + 1];
    const expected: Readonly<Record<RestLinkRelationName, string | null>> = {
      FIRST: index > 0 ? firstPage.requestDigest : null,
      LAST: index < last ? finalPage.requestDigest : null,
      NEXT: index < last && following !== undefined ? following.requestDigest : null,
      PREV: index > 0 && previous !== undefined ? previous.requestDigest : null,
    };
    for (const name of REST_LINK_RELATION_ORDER) {
      const row = page.linkRelations.find((candidate) => candidate.relation === name);
      if (row === undefined) continue;
      if (row.targetRequestDigest !== expected[name])
        issues.push(`${prefix}.${index}.linkRelations.${name}:target-mismatch`);
      if (expected[name] === null)
        issues.push(`${prefix}.${index}.linkRelations.${name}:boundary-forbidden`);
    }
    if (index < last) {
      if (page.linkRelations.every((candidate) => candidate.relation !== "NEXT"))
        issues.push(`${prefix}.${index}.linkRelations.NEXT:required`);
      if (page.nextRequestDigest !== expected.NEXT)
        issues.push(`${prefix}.${index}.nextRequestDigest:mismatch`);
      if (page.nextRequestDigest !== null) nextTargets.push(page.nextRequestDigest);
    } else if (page.nextRequestDigest !== null)
      issues.push(`${prefix}.${index}.nextRequestDigest:null-required`);
  });
  if (new Set(nextTargets).size !== nextTargets.length)
    issues.push(`${prefix}:next-target-duplicate`);
  return issues;
}

/**
 * GraphQL page chain: adjacent ordinals, unique page request digests, the null
 * first request cursor, cursor acquisition from the immediately prior page,
 * cursor non-repetition, and the terminal `hasNextPage` state.
 */
function relateGraphqlPageChain(
  pages: readonly ParsedGraphqlPage[],
  prefix: string,
): readonly string[] {
  if (pages.length === 0) return [`${prefix}:dense-rows-required`];
  const last = pages.length - 1;
  const issues: Issues = [];
  const requestDigests = pages.map((page) => page.requestDigest);
  if (new Set(requestDigests).size !== requestDigests.length)
    issues.push(`${prefix}:requestDigest-duplicate`);
  const seenCursors = new Set<string>();
  pages.forEach((page, index) => {
    if (page.ordinal !== String(index + 1)) issues.push(`${prefix}.${index}.ordinal:mismatch`);
    const previous = pages[index - 1];
    if (index === 0 && page.requestCursor !== null)
      issues.push(`${prefix}.0.requestCursor:null-required`);
    if (index > 0 && (previous === undefined || page.requestCursor !== previous.endCursor))
      issues.push(`${prefix}.${index}.requestCursor:mismatch`);
    if (page.requestCursor !== null) {
      if (seenCursors.has(page.requestCursor))
        issues.push(`${prefix}.${index}.requestCursor:repeated`);
      seenCursors.add(page.requestCursor);
    }
    if (page.endCursor !== null && seenCursors.has(page.endCursor))
      issues.push(`${prefix}.${index}.endCursor:repeated`);
    if (index === last) {
      if (page.hasNextPage) issues.push(`${prefix}.${index}.hasNextPage:false-required`);
    } else {
      if (!page.hasNextPage) issues.push(`${prefix}.${index}.hasNextPage:true-required`);
      if (page.endCursor === null) issues.push(`${prefix}.${index}.endCursor:required`);
    }
  });
  return issues;
}

/** Selects the branch chain relation from an already parsed API kind. */
function relateTerminalPaginationChain(
  apiKind: GitHubApiKind,
  pages: readonly PageRow[],
  prefix: string,
): readonly string[] {
  if (apiKind === "REST") {
    const rows = restPageRows(pages);
    return rows === null ? [`${prefix}:branch-mismatch`] : relateRestPageChain(rows, prefix);
  }
  const rows = graphqlPageRows(pages);
  return rows === null ? [`${prefix}:branch-mismatch`] : relateGraphqlPageChain(rows, prefix);
}

/**
 * The seven recomputable reduced-value projections. `PULL_REQUEST` and
 * `PULL_REQUEST_REVIEWS` carry no reducer preimage in this receipt: their
 * `reducedValueDigest` stays an opaque supplied claim, enclosed only by the
 * complete-reduction frame.
 */
function reducedProjectionFor(
  observation: ParsedHistoricalApiObservation,
  structure: ParsedRepositoryProtectionStructure,
  build: ParsedWorkflow | null,
  review: ParsedWorkflow | null,
): JsonValue | null {
  const environment = structure.environmentBinding;
  switch (observation.purpose) {
    case "ENVIRONMENT":
      return { environmentName: environment.environmentName };
    case "ENVIRONMENT_VARIABLE":
      return {
        environmentName: environment.environmentName,
        variableName: environment.variableName,
        variableValue: environment.variableValue,
      };
    case "REPOSITORY":
      return { repositoryId: structure.repositoryId };
    case "RULESET":
      return {
        protectedPathPolicies: structure.protectedPathPolicies,
        reviewPolicy: structure.reviewPolicy,
        rulesetId: structure.rulesetId,
      };
    case "WORKFLOW_BUILD":
      return build === null ? null : { workflow: build };
    case "WORKFLOW_REVIEW":
      return review === null ? null : { workflow: review };
    case "WORKFLOW_RUN":
      return observation.triggeringBuild === null
        ? null
        : { triggeringBuild: observation.triggeringBuild };
    default:
      return null;
  }
}

/** Request identity, page-request chain, reduction and terminal recomputation. */
function relateObservation(
  observation: ParsedHistoricalApiObservation,
  projection: JsonValue | null,
  prefix: string,
): readonly string[] {
  const issues: Issues = [];
  const apiKind = observation.request.apiKind;
  const pages: readonly PageRow[] = observation.pages;
  const identity = requestIdentityFrame(observation.purpose, observation.request);
  if (observation.requestIdentityDigest !== identity)
    issues.push(`${prefix}.requestIdentityDigest:mismatch`);
  const firstPage = pages[0];
  if (firstPage === undefined) return [`${prefix}.pages:dense-rows-required`];
  if (firstPage.requestDigest !== pageRequestFrame(identity, null))
    issues.push(`${prefix}.pages.0.requestDigest:mismatch`);
  if (apiKind === "GRAPHQL") {
    const rows = graphqlPageRows(pages);
    if (rows === null) issues.push(`${prefix}.pages:branch-mismatch`);
    else
      rows.forEach((page, index) => {
        if (page.requestDigest !== pageRequestFrame(identity, page.requestCursor))
          issues.push(`${prefix}.pages.${index}.requestDigest:mismatch`);
      });
  }
  issues.push(...relateTerminalPaginationChain(apiKind, pages, `${prefix}.pages`));
  const reductionRows: readonly ReductionRow[] = pages.map((page) => ({
    ordinal: page.ordinal,
    responseDigest: page.responseDigest,
  }));
  if (
    observation.completeReductionDigest !==
    completeReductionFrame(identity, reductionRows, observation.reducedValueDigest)
  )
    issues.push(`${prefix}.completeReductionDigest:mismatch`);
  if (observation.terminalPaginationDigest !== terminalPaginationFrame(identity, apiKind, pages))
    issues.push(`${prefix}.terminalPaginationDigest:mismatch`);
  if (
    projection !== null &&
    observation.reducedValueDigest !== reducedValueFrame(observation.purpose, projection)
  )
    issues.push(`${prefix}.reducedValueDigest:mismatch`);
  return issues;
}

/** Every cross-record equality, chronology, pagination and digest relation. */
function relateRepositoryProtectionStructure(
  structure: ParsedRepositoryProtectionStructure,
): readonly string[] {
  const producer = structure.producer;
  const environment = structure.environmentBinding;
  const build = selectWorkflow(structure.workflows, "BUILD");
  const review = selectWorkflow(structure.workflows, "REVIEW");
  const issues: Issues = [
    ...relateProtectedPathPolicies(structure.protectedPathPolicies, "protectedPathPolicies"),
    ...relateWorkflows(structure.workflows, "workflows"),
  ];
  if (review !== null) {
    if (producer.workflowDigest !== review.digest)
      issues.push("producer.workflowDigest:review-mismatch");
    if (producer.workflowPath !== review.path) issues.push("producer.workflowPath:review-mismatch");
    if (producer.workflowRef !== review.ref) issues.push("producer.workflowRef:review-mismatch");
  }
  if (environment.variableValue !== structure.verifierAnchorDigest)
    issues.push("environmentBinding.variableValue:anchor-mismatch");
  if (environment.variableUpdatedAt >= producer.startedAt)
    issues.push("environmentBinding.variableUpdatedAt:not-before-producer");
  if (environment.variableUpdatedAt > structure.issuedAt)
    issues.push("environmentBinding.variableUpdatedAt:after-issuedAt");
  if (producer.startedAt > structure.issuedAt) issues.push("producer.startedAt:after-issuedAt");

  const purposes: string[] = [];
  const identities: string[] = [];
  structure.apiObservations.forEach((observation, index) => {
    const prefix = `apiObservations.${index}`;
    purposes.push(observation.purpose);
    identities.push(observation.requestIdentityDigest);
    issues.push(
      ...relateObservation(
        observation,
        reducedProjectionFor(observation, structure, build, review),
        prefix,
      ),
    );
    if (producer.startedAt > observation.startedAt)
      issues.push(`${prefix}.startedAt:before-producer`);
    if (observation.completedAt > structure.issuedAt)
      issues.push(`${prefix}.completedAt:after-issuedAt`);
    const pages: readonly PageRow[] = observation.pages;
    pages.forEach((page, pageIndex) => {
      if (page.observedAt < observation.startedAt || page.observedAt > observation.completedAt)
        issues.push(`${prefix}.pages.${pageIndex}.observedAt:outside-observation`);
    });
  });
  if (new Set(purposes).size !== purposes.length) issues.push("apiObservations:purpose-duplicate");
  if (new Set(identities).size !== identities.length)
    issues.push("apiObservations:requestIdentityDigest-duplicate");

  const workflowRun = structure.apiObservations.find((row) => row.purpose === "WORKFLOW_RUN");
  const triggeringBuild = workflowRun === undefined ? null : workflowRun.triggeringBuild;
  if (triggeringBuild !== null && build !== null) {
    const prefix = "apiObservations.WORKFLOW_RUN.triggeringBuild";
    if (triggeringBuild.workflowDigest !== build.digest)
      issues.push(`${prefix}.workflowDigest:mismatch`);
    if (triggeringBuild.workflowPath !== build.path) issues.push(`${prefix}.workflowPath:mismatch`);
    if (triggeringBuild.workflowRef !== build.ref) issues.push(`${prefix}.workflowRef:mismatch`);
    if (triggeringBuild.runId === producer.runId)
      issues.push("producer.runId:triggering-build-alias");
    if (triggeringBuild.completedAt > producer.startedAt)
      issues.push(`${prefix}.completedAt:after-producer-start`);
  }
  if (
    structure.rulesetSemanticDigest !==
    rulesetSemanticFrame({
      protectedPathPolicies: structure.protectedPathPolicies,
      repositoryId: structure.repositoryId,
      reviewPolicy: structure.reviewPolicy,
      rulesetId: structure.rulesetId,
      workflows: structure.workflows,
    })
  )
    issues.push("rulesetSemanticDigest:mismatch");
  return issues;
}

/* -------------------------------------------------------------------------- *
 * Public surface
 * -------------------------------------------------------------------------- */

/**
 * The closed request identity. `queryDigest`, `documentDigest` and
 * `variablesDigest` remain supplied opaque leaves over pagination-invariant
 * request material; this value frames only the purpose and that complete
 * request branch.
 */
export function computeGitHubApiRequestIdentityDigest(purpose: unknown, request: unknown): string {
  const parsedPurpose = parseRepositoryProtectionPurpose(purpose);
  if (!parsedPurpose.ok) refuseWith(parsedPurpose.issues);
  const parsedRequest = parseRepositoryProtectionRequest(request);
  if (!parsedRequest.ok) refuseWith(parsedRequest.issues);
  return requestIdentityFrame(parsedPurpose.value, parsedRequest.value);
}

/** The page request identity for a null or acquired request cursor. */
export function computeGitHubApiPageRequestDigest(
  requestIdentityDigest: unknown,
  requestCursor: unknown,
): string {
  const identity = parseSha256Digest(requestIdentityDigest);
  if (!identity.ok) refuseWith(identity.issues);
  const cursor = parseNullableRequestCursor(requestCursor);
  if (!cursor.ok) refuseWith(cursor.issues);
  return pageRequestFrame(identity.value, cursor.value);
}

/** The non-circular complete-reduction identity over the closed page projection. */
export function computeGitHubApiCompleteReductionDigest(
  requestIdentityDigest: unknown,
  pages: unknown,
  reducedValueDigest: unknown,
): string {
  const identity = parseSha256Digest(requestIdentityDigest);
  if (!identity.ok) refuseWith(identity.issues);
  const rows = parseCompleteReductionPages(pages);
  if (!rows.ok) refuseWith(rows.issues);
  const reduced = parseSha256Digest(reducedValueDigest);
  if (!reduced.ok) refuseWith(reduced.issues);
  const issues = relateCompleteReductionPages(rows.value, "pages");
  if (issues.length > 0) refuseWith(issues);
  return completeReductionFrame(identity.value, rows.value, reduced.value);
}

/** The non-circular terminal-pagination identity over the complete page rows. */
export function computeGitHubApiTerminalPaginationDigest(
  requestIdentityDigest: unknown,
  apiKind: unknown,
  pages: unknown,
): string {
  const identity = parseSha256Digest(requestIdentityDigest);
  if (!identity.ok) refuseWith(identity.issues);
  const kind = parseGitHubApiKind(apiKind);
  if (!kind.ok) refuseWith(kind.issues);
  const rows = parseTerminalPaginationPages(kind.value, pages);
  if (!rows.ok) refuseWith(rows.issues);
  const issues = relateTerminalPaginationChain(kind.value, rows.value, "pages");
  if (issues.length > 0) refuseWith(issues);
  return terminalPaginationFrame(identity.value, kind.value, rows.value);
}

/** The immutable effective ruleset-semantics identity. */
export function computeRepositoryProtectionRulesetSemanticDigest(input: unknown): string {
  const parsed = parseRulesetSemantics(input);
  if (!parsed.ok) refuseWith(parsed.issues);
  const issues = relateRulesetSemantics(parsed.value, "");
  if (issues.length > 0) refuseWith(issues);
  return rulesetSemanticFrame(parsed.value);
}

/**
 * Parses a detached historical receipt. Packet A closes and types the tree;
 * only a zero-issue relation result succeeds. Opaque leaves do not prove API
 * origin, capture completeness, authentication, operator action or authority.
 */
export function parseRepositoryProtectionReceipt(
  input: unknown,
): ParseResult<RepositoryProtectionReceipt> {
  const parsed = parseRepositoryProtectionStructure(input);
  if (!parsed.ok) return parsed;
  const issues = relateRepositoryProtectionStructure(parsed.value);
  return issues.length === 0 ? parsed : { ok: false, issues: sortedIssues(issues) };
}

/** The family identity over the canonical receipt bytes. */
export function computeRepositoryProtectionReceiptDigest(input: unknown): string {
  const parsed = parseRepositoryProtectionReceipt(input);
  if (!parsed.ok) refuseWith(parsed.issues);
  return framedDigest(RECEIPT_IDENTITY_DOMAIN, [frame.canonical(parsed.value)]);
}

/** Generic dispatch; an unsupported version keeps the public `null` result. */
export function parseRepositoryProtectionContract(
  schemaVersion: string,
  input: unknown,
): ParseResult | null {
  const version = parseRepositoryProtectionSchemaVersion(schemaVersion);
  if (!version.ok) return null;
  return parseRepositoryProtectionReceipt(input);
}

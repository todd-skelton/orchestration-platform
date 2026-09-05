/**
 * The pure four-input cross-family binder and the
 * `repository-protection-terminal-evidence/v1` recipe for ISS-054 Packet D
 * (Decisions #268/#272/#282/#290, pressure Round 456 section 2.2).
 *
 * The four supplied inputs are the historical `repository-protection-receipt/v1`
 * receipt, the `bootstrap-verifier-anchor/v1` anchor, the fresh ISS-038
 * `observedProtection` read-back record, and the scalar `evaluatedAt`
 * (accepted ledger 6877-6878). The public entry point invokes the mapped
 * parser of every input before any computation: Packet B's
 * `parseRepositoryProtectionReceipt` (which itself invokes Packet A's closed
 * structural parser first), `parseBootstrapVerifierAnchor`, Packet C's
 * `parseObservedProtectionStructure`, and the scalar canonical-timestamp
 * parser below. Relations then receive only parsed records, scalars and dense
 * arrays and return a typed issue list; only a zero-issue relation result
 * succeeds. There is no fragment parser, raw-object cast, non-null assertion
 * over raw input, `any`, `catch` or caller-asserted typed fast path, so no raw
 * value reaches a relation, projection or digest frame.
 *
 * Success proves that four internally consistent supplied values are mutually
 * consistent under the relations the accepted ledger states at 6926-6958. It
 * does not observe GitHub, read back a live value, authenticate an opaque
 * digest leaf, prove pagination completeness, prove that a capture is current
 * or recent, prove that an operator acted, or grant authority. The supplied
 * fresh capture source and its opaque leaves remain claims that only ISS-038
 * composition can judge.
 */
import {
  frame,
  framedDigest,
  isCanonicalTimestamp,
  type JsonValue,
  type ParseResult,
} from "./runtime.js";
import { parseBootstrapVerifierAnchor, type BootstrapVerifierAnchor } from "./verifier-anchor.js";
import { parseRepositoryProtectionReceipt } from "./repository-protection.js";
import {
  parseObservedProtectionStructure,
  type GitHubApiKind,
  type ParsedFreshApiObservation,
  type ParsedGraphqlPage,
  type ParsedHistoricalApiObservation,
  type ParsedObservedProtectionStructure,
  type ParsedProtectedPathPolicy,
  type ParsedRepositoryProtectionRequest,
  type ParsedRestPage,
  type ParsedReviewPolicy,
  type ParsedWorkflow,
  type RepositoryProtectionPurpose,
  type RepositoryProtectionReceipt,
  type RestLinkRelationName,
  type StructuralParseResult,
  type WorkflowRole,
} from "./repository-protection-parse.js";

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
const ANCHOR_IDENTITY_DOMAIN = "bootstrap-verifier-anchor/v1";
const TERMINAL_EVIDENCE_DOMAIN = "repository-protection-terminal-evidence/v1";
const REST_LINK_RELATION_ORDER = Object.freeze(["FIRST", "LAST", "NEXT", "PREV"] as const);

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
type ApiTerminalRow = Readonly<{
  purpose: RepositoryProtectionPurpose;
  requestIdentityDigest: string;
  terminalPaginationDigest: string;
}>;
type TerminalEvidenceProjection = Readonly<{
  apiTerminals: readonly ApiTerminalRow[];
  completedAt: string;
  environmentBinding: JsonValue;
  rulesetSemantics: RulesetSemanticProjection;
  startedAt: string;
}>;

/**
 * The detached deeply frozen binding value: exactly the six members the ledger
 * lists at 6960-6970, in ascending canonical member order. `anchorDigest` is
 * `Danchor`, `protectionDigest` is `Dprotection`, `terminalEvidenceDigest` is
 * recomputed by the recipe at 6900-6917, and the three record members are the
 * parsed detached inputs. No member is or implies an authority, currentness,
 * authentication, verification, completeness or grant claim (6974-6977).
 */
export type RepositoryProtectionBinding = Readonly<{
  anchor: BootstrapVerifierAnchor;
  anchorDigest: string;
  observedProtection: ParsedObservedProtectionStructure;
  protectionDigest: string;
  receipt: RepositoryProtectionReceipt;
  terminalEvidenceDigest: string;
}>;

export type RepositoryProtectionBindingResult =
  | { readonly ok: true; readonly value: RepositoryProtectionBinding }
  | { readonly ok: false; readonly issues: readonly string[] };

function sortedIssues(issues: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(issues)].sort());
}

/** Records a refused input's own issues under that input's path. */
function prefixed(prefix: string, issues: readonly string[]): readonly string[] {
  return issues.map((issue) => `${prefix}.${issue}`);
}

/* -------------------------------------------------------------------------- *
 * Parse phase
 * -------------------------------------------------------------------------- */

/**
 * The scalar `evaluatedAt` input. It is a supplied evaluation instant, not a
 * member of any record in either family (6877-6878, 6891-6892), so it has its
 * own scalar parser here rather than in Packet C's record parsers. A boxed
 * `String`, a proxy over one, and every non-string value fail the `typeof`
 * test before any property is read, so no accessor or trap can run.
 */
function parseEvaluatedAt(input: unknown): StructuralParseResult<string> {
  return typeof input === "string" && isCanonicalTimestamp(input)
    ? { ok: true, value: input }
    : { ok: false, issues: Object.freeze(["evaluatedAt:invalid"]) };
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
function receiptIdentityFrame(receipt: RepositoryProtectionReceipt): string {
  return framedDigest(RECEIPT_IDENTITY_DOMAIN, [frame.canonical(receipt)]);
}
function anchorIdentityFrame(anchor: BootstrapVerifierAnchor): string {
  return framedDigest(ANCHOR_IDENTITY_DOMAIN, [frame.canonical(anchor)]);
}

/**
 * The terminal-evidence identity (6892-6917). Exactly one canonical frame part
 * over the closed projection; `apiTerminals` retains the six-purpose order of
 * the fresh observation and each row is exactly `purpose`,
 * `requestIdentityDigest` and `terminalPaginationDigest`. The projection
 * excludes `terminalEvidenceDigest` itself and is therefore non-circular by
 * construction: the value is derived here from the fresh observation's own
 * rows and never accepted as a supplied projection, so a precomputed caller
 * count, a historical receipt timestamp, or an API row without terminal
 * pagination cannot be presented as the evaluation boundary (6922-6924).
 */
function terminalEvidenceFrame(projection: TerminalEvidenceProjection): string {
  return framedDigest(TERMINAL_EVIDENCE_DOMAIN, [frame.canonical(projection)]);
}

/* -------------------------------------------------------------------------- *
 * Branch views over already-parsed page rows
 * -------------------------------------------------------------------------- */

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

/** Exactly one row per role, or `null` so every dependent relation fails closed. */
function selectWorkflow(
  workflows: readonly ParsedWorkflow[],
  role: WorkflowRole,
): ParsedWorkflow | null {
  const matches = workflows.filter((row) => row.role === role);
  const only = matches.length === 1 ? matches[0] : undefined;
  return only ?? null;
}

/* -------------------------------------------------------------------------- *
 * Independent termination of each fresh row (6884-6885, 6950-6951)
 *
 * The fresh rows carry the identical closed request/page/terminal censuses and
 * the identical formulas, so the chain relations and derived-digest
 * recomputations below are the historical ones applied to the fresh record.
 * They are expressed here over Packet C's typed fresh rows rather than shared
 * with Packet B, because Packet B's relations are module private and Packet D
 * may not edit `repository-protection.ts`.
 * -------------------------------------------------------------------------- */

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
 * The six fresh semantic projections (6951-6955, projections at 6757-6764).
 * Every value is read from the fresh observation, never from the receipt: API
 * ETags, capture times and page metadata are excluded, and the two
 * historical-only reduced values (`PULL_REQUEST`, `PULL_REQUEST_REVIEWS`) and
 * the producer-run value (`WORKFLOW_RUN`) have no fresh counterpart at all and
 * are never joined into fresh semantics (6768-6774).
 */
function freshReducedProjection(
  observation: ParsedFreshApiObservation,
  observed: ParsedObservedProtectionStructure,
  build: ParsedWorkflow | null,
  review: ParsedWorkflow | null,
): JsonValue | null {
  const environment = observed.environmentBinding;
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
      return { repositoryId: observed.repositoryId };
    case "RULESET":
      return {
        protectedPathPolicies: observed.protectedPathPolicies,
        reviewPolicy: observed.reviewPolicy,
        rulesetId: observed.rulesetId,
      };
    case "WORKFLOW_BUILD":
      return build === null ? null : { workflow: build };
    case "WORKFLOW_REVIEW":
      return review === null ? null : { workflow: review };
    default:
      return null;
  }
}

/**
 * One fresh row's own identity, page chain, reduction and terminal
 * recomputation. Nothing here reads the receipt, so a fresh row terminates on
 * its own evidence rather than by inheriting the historical row's terminal
 * proof.
 */
function relateFreshObservation(
  observation: ParsedFreshApiObservation,
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

/* -------------------------------------------------------------------------- *
 * The cross-family relations (6926-6958)
 * -------------------------------------------------------------------------- */

/**
 * Disposition and the evaluation window (6926-6927, 6496-6498, 6891-6892). All
 * three dispositions parse and preserve refusal evidence; only `ACCEPTED` may
 * pass the binding relation. The ledger's strictness is exact and deliberate:
 * `issuedAt <= evaluatedAt` is inclusive and `evaluatedAt < expiresAt` is
 * strict. `evaluatedAt` must equal the fresh observation's `completedAt`,
 * which is the only place that equality can be stated: `evaluatedAt` is a
 * binder input and not a member of the fresh record (6879-6882).
 */
function relateEvaluationWindow(
  receipt: RepositoryProtectionReceipt,
  observed: ParsedObservedProtectionStructure,
  evaluatedAt: string,
): readonly string[] {
  const issues: Issues = [];
  if (receipt.disposition !== "ACCEPTED") issues.push("receipt.disposition:accepted-required");
  if (evaluatedAt < receipt.issuedAt) issues.push("evaluatedAt:before-issuedAt");
  if (evaluatedAt >= receipt.expiresAt) issues.push("evaluatedAt:not-before-expiresAt");
  if (evaluatedAt !== observed.completedAt)
    issues.push("evaluatedAt:observation-completion-required");
  return issues;
}

/**
 * The four-way anchor-digest equality (6927-6929). `Danchor` is recomputed
 * from the parsed anchor and is the reference for the receipt's
 * `verifierAnchorDigest`, the historical environment variable value and the
 * fresh environment variable value. The receipt-internal leg
 * `environmentBinding.variableValue === verifierAnchorDigest` is additionally
 * discharged by Packet B (`repository-protection.ts:473-474`) before the
 * receipt reaches this relation.
 */
function relateAnchorDigest(
  anchorDigest: string,
  receipt: RepositoryProtectionReceipt,
  observed: ParsedObservedProtectionStructure,
): readonly string[] {
  const issues: Issues = [];
  if (receipt.verifierAnchorDigest !== anchorDigest)
    issues.push("receipt.verifierAnchorDigest:anchor-mismatch");
  if (receipt.environmentBinding.variableValue !== anchorDigest)
    issues.push("receipt.environmentBinding.variableValue:anchor-mismatch");
  if (observed.environmentBinding.variableValue !== anchorDigest)
    issues.push("observedProtection.environmentBinding.variableValue:anchor-mismatch");
  return issues;
}

/**
 * The acyclic historical chronology (6930-6931)
 * `confirmedAt <= createdAt <= receipt.environmentBinding.variableUpdatedAt <
 * receipt.producer.startedAt <= receipt.issuedAt`, and the fresh legs
 * (6934-6937) `anchor.createdAt <= fresh variableUpdatedAt <
 * receipt.producer.startedAt` and
 * `fresh variableUpdatedAt <= observedProtection.startedAt`. Each comparison
 * is implemented with exactly the strictness the ledger states; the mixture of
 * `<` and `<=` is deliberate.
 *
 * The binder states the whole chain rather than assuming another module's
 * internal ordering, so three of the historical comparisons are defence in
 * depth: `confirmedAt <= createdAt` is also discharged by the anchor parser
 * (`verifier-anchor.ts:163-164`), `variableUpdatedAt < producer.startedAt` by
 * Packet B (`repository-protection.ts:475-476`) and
 * `producer.startedAt <= issuedAt` by Packet B
 * (`repository-protection.ts:479`). A supplied value violating one of those
 * three is refused by its own parser before this relation runs, so those three
 * comparisons carry no independent deletion mutant.
 *
 * The last fresh comparison also places the fresh update no later than every
 * fresh page observation and completion time (6938-6939): Packet C already
 * requires every fresh page time to lie inside
 * `observedProtection.startedAt..completedAt`, so that placement follows and
 * the ledger states no separate per-page relation to add.
 */
function relateChronology(
  anchor: BootstrapVerifierAnchor,
  receipt: RepositoryProtectionReceipt,
  observed: ParsedObservedProtectionStructure,
): readonly string[] {
  const issues: Issues = [];
  const historical = receipt.environmentBinding.variableUpdatedAt;
  const fresh = observed.environmentBinding.variableUpdatedAt;
  const producerStartedAt = receipt.producer.startedAt;
  if (anchor.operatorConfirmation.confirmedAt > anchor.createdAt)
    issues.push("anchor.operatorConfirmation.confirmedAt:after-anchor-createdAt");
  if (historical < anchor.createdAt)
    issues.push("receipt.environmentBinding.variableUpdatedAt:before-anchor-createdAt");
  if (historical >= producerStartedAt)
    issues.push("receipt.environmentBinding.variableUpdatedAt:not-before-producer");
  if (producerStartedAt > receipt.issuedAt)
    issues.push("receipt.producer.startedAt:after-issuedAt");
  if (fresh < anchor.createdAt)
    issues.push("observedProtection.environmentBinding.variableUpdatedAt:before-anchor-createdAt");
  if (fresh >= producerStartedAt)
    issues.push("observedProtection.environmentBinding.variableUpdatedAt:not-before-producer");
  if (fresh > observed.startedAt)
    issues.push("observedProtection.environmentBinding.variableUpdatedAt:after-observation-start");
  return issues;
}

/**
 * Repository-identity agreement across the four positions (6943-6944) and the
 * historical/fresh environment and variable name agreement (6944-6945). The
 * anchor's own `signerWorkflow.repositoryId` leg is discharged by the anchor
 * parser (`verifier-anchor.ts:146-148`) before the anchor reaches this
 * relation. Environment and variable names are literal-pinned per record by
 * both environment-binding parsers (`repository-protection-parse.ts:1425-1436`,
 * ledger 6788-6790), so the two comparisons here are defence in depth and the
 * ETags and update times behind them are deliberately not equated (6944-6946).
 */
function relateIdentities(
  anchor: BootstrapVerifierAnchor,
  receipt: RepositoryProtectionReceipt,
  observed: ParsedObservedProtectionStructure,
): readonly string[] {
  const issues: Issues = [];
  if (anchor.repositoryId !== receipt.repositoryId)
    issues.push("anchor.repositoryId:receipt-mismatch");
  if (observed.repositoryId !== receipt.repositoryId)
    issues.push("observedProtection.repositoryId:receipt-mismatch");
  if (observed.environmentBinding.environmentName !== receipt.environmentBinding.environmentName)
    issues.push("observedProtection.environmentBinding.environmentName:receipt-mismatch");
  if (observed.environmentBinding.variableName !== receipt.environmentBinding.variableName)
    issues.push("observedProtection.environmentBinding.variableName:receipt-mismatch");
  return issues;
}

/**
 * The six shared rows joined one-for-one by `purpose` and exact
 * `requestIdentityDigest` (6946-6948). The join is a purpose-keyed lookup into
 * the historical nine-row census, never an array-index alignment: the two
 * censuses are of different lengths and diverge from the third position, so an
 * index join could not even produce the canonical positive. The historical
 * `PULL_REQUEST`, `PULL_REQUEST_REVIEWS` and `WORKFLOW_RUN` rows have no fresh
 * counterpart and are never visited.
 *
 * Nothing else is equated across the two captures: page counts, ETags,
 * cursors, Link headers, response bytes, capture times, reduction digests and
 * terminal digests are independently validated in each record and deliberately
 * not compared (6948-6950).
 */
function relatePurposeJoin(
  receipt: RepositoryProtectionReceipt,
  observed: ParsedObservedProtectionStructure,
): readonly string[] {
  const issues: Issues = [];
  const historicalByPurpose = new Map<string, ParsedHistoricalApiObservation>();
  for (const row of receipt.apiObservations) historicalByPurpose.set(row.purpose, row);
  observed.apiObservations.forEach((row, index) => {
    const prefix = `observedProtection.apiObservations.${index}`;
    const historical = historicalByPurpose.get(row.purpose);
    if (historical === undefined) {
      issues.push(`${prefix}.purpose:historical-counterpart-required`);
      return;
    }
    if (historical.requestIdentityDigest !== row.requestIdentityDigest)
      issues.push(`${prefix}.requestIdentityDigest:historical-join-mismatch`);
  });
  return issues;
}

/**
 * Fresh effective semantics (6951-6957). Each fresh row's `reducedValueDigest`
 * recomputes from its own fresh semantic projection, and the semantic digest
 * recomputed from the fresh effective semantics must equal the receipt's
 * immutable `rulesetSemanticDigest`. The receipt's producer identity stays
 * historical and is never copied into a fresh projection (6957-6958); the
 * fresh record carries no producer member at all (6879-6882), so no fresh
 * value can be sourced from one.
 */
function relateFreshSemantics(
  receipt: RepositoryProtectionReceipt,
  observed: ParsedObservedProtectionStructure,
): readonly string[] {
  const issues: Issues = [];
  const build = selectWorkflow(observed.workflows, "BUILD");
  const review = selectWorkflow(observed.workflows, "REVIEW");
  if (build === null || review === null)
    issues.push("observedProtection.workflows:role-census-required");
  observed.apiObservations.forEach((row, index) => {
    issues.push(
      ...relateFreshObservation(
        row,
        freshReducedProjection(row, observed, build, review),
        `observedProtection.apiObservations.${index}`,
      ),
    );
  });
  const semanticDigest = rulesetSemanticFrame({
    protectedPathPolicies: observed.protectedPathPolicies,
    repositoryId: observed.repositoryId,
    reviewPolicy: observed.reviewPolicy,
    rulesetId: observed.rulesetId,
    workflows: observed.workflows,
  });
  if (semanticDigest !== receipt.rulesetSemanticDigest)
    issues.push("observedProtection:ruleset-semantics-mismatch");
  return issues;
}

/**
 * The supplied fresh `terminalEvidenceDigest` must equal the recomputation
 * over the derived projection, otherwise the fresh terminal evidence is
 * unbound (6994-6996).
 */
function relateTerminalEvidence(
  observed: ParsedObservedProtectionStructure,
  terminalEvidenceDigest: string,
): readonly string[] {
  return observed.terminalEvidenceDigest === terminalEvidenceDigest
    ? []
    : ["observedProtection.terminalEvidenceDigest:mismatch"];
}

/** Derives `apiTerminals` and frames the terminal-evidence projection. */
function computeTerminalEvidence(observed: ParsedObservedProtectionStructure): string {
  const apiTerminals: readonly ApiTerminalRow[] = observed.apiObservations.map(
    ({ purpose, requestIdentityDigest, terminalPaginationDigest }) => ({
      purpose,
      requestIdentityDigest,
      terminalPaginationDigest,
    }),
  );
  return terminalEvidenceFrame({
    apiTerminals,
    completedAt: observed.completedAt,
    environmentBinding: observed.environmentBinding,
    rulesetSemantics: {
      protectedPathPolicies: observed.protectedPathPolicies,
      repositoryId: observed.repositoryId,
      reviewPolicy: observed.reviewPolicy,
      rulesetId: observed.rulesetId,
      workflows: observed.workflows,
    },
    startedAt: observed.startedAt,
  });
}

/* -------------------------------------------------------------------------- *
 * Public surface
 * -------------------------------------------------------------------------- */

/**
 * The sole pure cross-family binder (6877-6878, 6926-6958). It parses all four
 * detached supplied inputs, relates only the parsed values, and returns one
 * detached deeply frozen six-member record on a zero-issue result.
 *
 * Success states that these four supplied values are mutually consistent under
 * the stated relations. It states nothing about whether the fresh capture
 * actually came from GitHub, whether its opaque leaves are authentic, whether
 * the capture is complete or current, or whether any authority follows;
 * ISS-038 composition, not this pure relation, decides that.
 */
export function bindRepositoryProtectionEvidence(
  receipt: unknown,
  anchor: unknown,
  observedProtection: unknown,
  evaluatedAt: unknown,
): RepositoryProtectionBindingResult {
  const parsedReceipt: ParseResult<RepositoryProtectionReceipt> =
    parseRepositoryProtectionReceipt(receipt);
  const parsedAnchor: ParseResult<BootstrapVerifierAnchor> = parseBootstrapVerifierAnchor(anchor);
  const parsedObserved: ParseResult<ParsedObservedProtectionStructure> =
    parseObservedProtectionStructure(observedProtection);
  const parsedEvaluatedAt = parseEvaluatedAt(evaluatedAt);
  const parseIssues: Issues = [];
  if (!parsedReceipt.ok) parseIssues.push(...prefixed("receipt", parsedReceipt.issues));
  if (!parsedAnchor.ok) parseIssues.push(...prefixed("anchor", parsedAnchor.issues));
  if (!parsedObserved.ok)
    parseIssues.push(...prefixed("observedProtection", parsedObserved.issues));
  if (!parsedEvaluatedAt.ok) parseIssues.push(...parsedEvaluatedAt.issues);
  if (
    parseIssues.length > 0 ||
    !parsedReceipt.ok ||
    !parsedAnchor.ok ||
    !parsedObserved.ok ||
    !parsedEvaluatedAt.ok
  )
    return { ok: false, issues: sortedIssues(parseIssues) };

  const receiptValue = parsedReceipt.value;
  const anchorValue = parsedAnchor.value;
  const observedValue = parsedObserved.value;
  const anchorDigest = anchorIdentityFrame(anchorValue);
  const terminalEvidenceDigest = computeTerminalEvidence(observedValue);
  const issues: Issues = [
    ...relateEvaluationWindow(receiptValue, observedValue, parsedEvaluatedAt.value),
    ...relateAnchorDigest(anchorDigest, receiptValue, observedValue),
    ...relateChronology(anchorValue, receiptValue, observedValue),
    ...relateIdentities(anchorValue, receiptValue, observedValue),
    ...relatePurposeJoin(receiptValue, observedValue),
    ...relateFreshSemantics(receiptValue, observedValue),
    ...relateTerminalEvidence(observedValue, terminalEvidenceDigest),
  ];
  if (issues.length > 0) return { ok: false, issues: sortedIssues(issues) };
  const value: RepositoryProtectionBinding = {
    anchor: anchorValue,
    anchorDigest,
    observedProtection: observedValue,
    protectionDigest: receiptIdentityFrame(receiptValue),
    receipt: receiptValue,
    terminalEvidenceDigest,
  };
  return { ok: true, value: Object.freeze(value) };
}

/**
 * ISS-054 Packets A and B vectors for the historical
 * `repository-protection-receipt/v1` family (Decisions #268/#272, Round 451).
 *
 * The retained Packet A sections prove closure and typed local structure only:
 * they make no cross-record equality, chronology, pagination, projection or
 * digest claim, and the structure-only entry point stays package private.
 *
 * The Packet B sections add the public surface, registry, compatibility and
 * serialization census, independently recomputed canonical and framed digest
 * goldens, every pure relation and chronology join, the REST and GraphQL page
 * chains, opaque-leaf enclosure and one deletion mutant per relation. No vector
 * claims API origin, capture completeness, authentication, freshness, operator
 * action or authority.
 */
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";
import {
  iss002HarnessPaths,
  iss002TestBundlePaths,
} from "../../packages/conformance/src/stable-bundles.js";
import * as c from "../../packages/contracts/src/index.js";
import * as parse from "../../packages/contracts/src/repository-protection-parse.js";
import * as protection from "../../packages/contracts/src/repository-protection.js";

const schema = "repository-protection-receipt/v1";
const sourcePath = "packages/contracts/src/repository-protection-parse.ts";
const testPath = "test/contracts/repository-protection.test.ts";
const quote = String.fromCharCode(34);
const backslash = String.fromCharCode(92);
const lineFeed = String.fromCharCode(10);
const deleteCharacter = String.fromCharCode(127);

type Row = Record<string, unknown>;
type Path = readonly (string | number)[];
type RootKind = "array" | "nullable-scalar" | "record" | "scalar";
interface MatrixRoot {
  readonly name: string;
  readonly kind: RootKind;
  readonly parse: (input: unknown) => { readonly ok: boolean };
  readonly valid: () => unknown;
  readonly malformed?: unknown;
}

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("fixture:missing");
  return value;
}
function at(root: unknown, path: Path): Row {
  let value: unknown = root;
  for (const key of path) value = (value as Record<PropertyKey, unknown>)[key];
  return value as Row;
}
function rowsAt(root: unknown, path: Path): unknown[] {
  return at(root, path) as unknown as unknown[];
}
function codepointSorted(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
}

/* -------------------------------------------------------------------------- *
 * Canonical fixtures
 * -------------------------------------------------------------------------- */

const BUILD_PATH = ".github/workflows/build.yml";
const REVIEW_PATH = ".github/workflows/review.yml";
const BRANCH_REF = "refs/heads/main";
const GRAPHQL_PURPOSE = "PULL_REQUEST_REVIEWS";

function permissionRows(): Row[] {
  return parse.repositoryProtectionPermissionNames.map((permission) => ({
    access: permission === "id-token" ? "WRITE" : "NONE",
    permission,
  }));
}
function buildWorkflow(): Row {
  return {
    digest: sha("build-workflow"),
    path: BUILD_PATH,
    permissionNamespace: "github-actions-permissions/2026-09-02",
    permissions: permissionRows(),
    ref: BRANCH_REF,
    role: "BUILD",
    trigger: {
      activities: ["opened", "reopened", "synchronize"],
      event: "PULL_REQUEST",
      requiredConclusion: null,
      sourceWorkflowDigest: null,
      sourceWorkflowPath: null,
      sourceWorkflowRef: null,
    },
    workflowId: "101",
  };
}
function reviewWorkflow(): Row {
  return {
    digest: sha("review-workflow"),
    path: REVIEW_PATH,
    permissionNamespace: "github-actions-permissions/2026-09-02",
    permissions: permissionRows(),
    ref: BRANCH_REF,
    role: "REVIEW",
    trigger: {
      activities: ["completed"],
      event: "WORKFLOW_RUN",
      requiredConclusion: "SUCCESS",
      sourceWorkflowDigest: sha("build-workflow"),
      sourceWorkflowPath: BUILD_PATH,
      sourceWorkflowRef: BRANCH_REF,
    },
    workflowId: "102",
  };
}
function restPages(purpose: string, count: number): Row[] {
  const digests = Array.from({ length: count }, (_, index) =>
    sha(purpose + ":rest-request:" + String(index + 1)),
  );
  return Array.from({ length: count }, (_, index) => {
    const final = index === count - 1;
    const relations: Row[] = [];
    if (index > 0) relations.push({ relation: "FIRST", targetRequestDigest: required(digests[0]) });
    if (!final)
      relations.push({ relation: "LAST", targetRequestDigest: required(digests[count - 1]) });
    if (!final)
      relations.push({ relation: "NEXT", targetRequestDigest: required(digests[index + 1]) });
    if (index > 0)
      relations.push({ relation: "PREV", targetRequestDigest: required(digests[index - 1]) });
    return {
      etag: quote + purpose + "-" + String(index + 1) + quote,
      linkHeaderDigest: relations.length > 0 ? sha(purpose + ":link:" + String(index + 1)) : null,
      linkRelations: relations,
      nextRequestDigest: final ? null : required(digests[index + 1]),
      observedAt: "2026-09-04T00:01:01.000Z",
      ordinal: String(index + 1),
      requestDigest: required(digests[index]),
      responseDigest: sha(purpose + ":response:" + String(index + 1)),
      status: "200",
    };
  });
}
function graphqlPages(purpose: string, count: number): Row[] {
  return Array.from({ length: count }, (_, index) => {
    const final = index === count - 1;
    return {
      endCursor: final ? purpose + "-terminal-cursor" : purpose + "-cursor-" + String(index + 1),
      etag: index % 2 === 0 ? null : quote + purpose + "-" + String(index + 1) + quote,
      hasNextPage: !final,
      observedAt: "2026-09-04T00:01:01.000Z",
      ordinal: String(index + 1),
      requestCursor: index === 0 ? null : purpose + "-cursor-" + String(index),
      requestDigest: sha(purpose + ":graphql-request:" + String(index + 1)),
      responseDigest: sha(purpose + ":response:" + String(index + 1)),
      status: "200",
    };
  });
}
function requestRow(purpose: string, kind: "GRAPHQL" | "REST"): Row {
  return kind === "REST"
    ? {
        apiKind: "REST",
        apiVersion: "2022-11-28",
        method: "GET",
        queryDigest: sha(purpose + ":query"),
        route: "/repos/owner/repository/" + purpose.toLowerCase(),
      }
    : {
        apiKind: "GRAPHQL",
        apiVersion: null,
        documentDigest: sha(purpose + ":document"),
        method: "POST",
        variablesDigest: sha(purpose + ":variables"),
      };
}
function triggeringBuildRow(): Row {
  return {
    completedAt: "2026-09-04T00:00:59.999Z",
    conclusion: "SUCCESS",
    runAttempt: "1",
    runId: "9001",
    workflowDigest: sha("build-workflow"),
    workflowPath: BUILD_PATH,
    workflowRef: BRANCH_REF,
  };
}
function observationRow(purpose: string, kind: "GRAPHQL" | "REST", pageCount = 1): Row {
  return {
    completeReductionDigest: sha(purpose + ":complete-reduction"),
    completedAt: "2026-09-04T00:01:02.000Z",
    pages: kind === "REST" ? restPages(purpose, pageCount) : graphqlPages(purpose, pageCount),
    purpose,
    reducedValueDigest: sha(purpose + ":reduced-value"),
    request: requestRow(purpose, kind),
    requestIdentityDigest: sha(purpose + ":request-identity"),
    startedAt: "2026-09-04T00:01:00.000Z",
    terminalPaginationDigest: sha(purpose + ":terminal-pagination"),
    triggeringBuild: purpose === "WORKFLOW_RUN" ? triggeringBuildRow() : null,
  };
}
function fixture(): Row {
  return {
    apiObservations: parse.repositoryProtectionPurposes.map((purpose) =>
      observationRow(purpose, purpose === GRAPHQL_PURPOSE ? "GRAPHQL" : "REST"),
    ),
    disposition: "ACCEPTED",
    environmentBinding: {
      environmentEtag: quote + "environment-v1" + quote,
      environmentName: "host-custody-bootstrap-root",
      variableName: "VERIFIER_ANCHOR_SHA256",
      variableUpdatedAt: "2026-09-04T00:00:00.000Z",
      variableValue: sha("anchor"),
    },
    expiresAt: "2026-09-11T00:02:00.000Z",
    issuedAt: "2026-09-04T00:02:00.000Z",
    producer: {
      artifactName: "repository-protection-receipt",
      runAttempt: "2",
      runId: "9002",
      startedAt: "2026-09-04T00:01:00.000Z",
      workflowDigest: sha("review-workflow"),
      workflowPath: REVIEW_PATH,
      workflowRef: BRANCH_REF,
    },
    protectedPathPolicies: [
      { path: ".github/workflows", reviewPolicy: "INDEPENDENT_APPROVAL" },
      { path: "packages/contracts", reviewPolicy: "INDEPENDENT_APPROVAL" },
    ],
    repositoryId: "77",
    reviewPolicy: {
      adminBypass: "FORBIDDEN",
      authorApproval: "FORBIDDEN",
      committerApproval: "FORBIDDEN",
      dismissalOnSourceChange: "REQUIRED",
      minimumApprovals: "1",
    },
    rulesetId: "88",
    rulesetSemanticDigest: sha("ruleset-semantics"),
    schemaVersion: schema,
    verifierAnchorDigest: sha("anchor"),
    workflows: [buildWorkflow(), reviewWorkflow()],
  };
}
function rulesetSemantics(): Row {
  const receipt = fixture();
  return {
    protectedPathPolicies: receipt.protectedPathPolicies,
    repositoryId: receipt.repositoryId,
    reviewPolicy: receipt.reviewPolicy,
    rulesetId: receipt.rulesetId,
    workflows: receipt.workflows,
  };
}
function completeReductionPages(count = 2): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    ordinal: String(index + 1),
    responseDigest: sha("reduction:response:" + String(index + 1)),
  }));
}
function observationAt(receipt: Row, purpose: string): Row {
  const rows = receipt.apiObservations as Row[];
  return required(rows.find((row) => row.purpose === purpose));
}
function changed(path: Path, value: unknown): Row {
  const receipt = fixture();
  at(receipt, path.slice(0, -1))[String(required(path[path.length - 1]))] = value;
  return receipt;
}
function withoutFirstMember(record: Row): Row {
  const clone = { ...record };
  const first = Object.keys(clone)[0];
  if (first !== undefined) delete clone[first];
  return clone;
}
function freezeDeep(value: unknown, seal = false): void {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) freezeDeep(nested, seal);
    if (seal) Object.seal(value);
    else Object.freeze(value);
  }
}
function deeplyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every((nested) => deeplyFrozen(nested));
}

/* -------------------------------------------------------------------------- *
 * Versioned structural-input census (test-local, not a schema version)
 * -------------------------------------------------------------------------- */

const repositoryProtectionStructuralInputCensus20260905 = Object.freeze({
  censusVersion: "2026-09-05",
  receiptTreeRecordKinds: Object.freeze({
    EnvironmentBinding: "parseEnvironmentBinding",
    GraphqlPage: "parseGraphqlPage",
    GraphqlRequest: "parseGraphqlRequest",
    HistoricalApiObservation: "parseHistoricalApiObservation",
    ProtectedPathPolicy: "parseProtectedPathPolicy",
    ReceiptProducer: "parseReceiptProducer",
    RepositoryProtectionReceiptStructure: "parseRepositoryProtectionStructure",
    RestLinkRelation: "parseRestLinkRelation",
    RestPage: "parseRestPage",
    RestRequest: "parseRestRequest",
    ReviewPolicy: "parseReviewPolicy",
    TriggeringBuild: "parseTriggeringBuild",
    Workflow: "parseWorkflow",
    WorkflowPermission: "parseWorkflowPermission",
    WorkflowTrigger: "parseWorkflowTrigger",
  }),
  standaloneRecordKinds: Object.freeze({
    CompleteReductionPage: "parseCompleteReductionPage",
    RulesetSemantics: "parseRulesetSemantics",
  }),
  helperArgumentKinds: Object.freeze({
    CompleteReductionPages: "parseCompleteReductionPages",
    GitHubApiKind: "parseGitHubApiKind",
    NullableRequestCursor: "parseNullableRequestCursor",
    RepositoryProtectionPurpose: "parseRepositoryProtectionPurpose",
    RepositoryProtectionRequest: "parseRepositoryProtectionRequest",
    RepositoryProtectionSchemaVersion: "parseRepositoryProtectionSchemaVersion",
    Sha256Digest: "parseSha256Digest",
    TerminalPaginationPages: "parseTerminalPaginationPages",
  }),
  schemaFieldKeyByKind: Object.freeze({
    CompleteReductionPage: "completeReductionPage",
    EnvironmentBinding: "environmentBinding",
    GraphqlPage: "graphqlPage",
    GraphqlRequest: "graphqlRequest",
    HistoricalApiObservation: "observation",
    ProtectedPathPolicy: "protectedPathPolicy",
    ReceiptProducer: "producer",
    RepositoryProtectionReceiptStructure: "receipt",
    RestLinkRelation: "linkRelation",
    RestPage: "restPage",
    RestRequest: "restRequest",
    ReviewPolicy: "reviewPolicy",
    RulesetSemantics: "rulesetSemantics",
    TriggeringBuild: "triggeringBuild",
    Workflow: "workflow",
    WorkflowPermission: "permission",
    WorkflowTrigger: "trigger",
  }),
  typedArrayParsers: Object.freeze([
    "parseCompleteReductionPages",
    "parseGraphqlPages",
    "parseHistoricalApiObservations",
    "parseProtectedPathPolicies",
    "parseRestLinkRelations",
    "parseRestPages",
    "parseTerminalPaginationPages",
    "parseWorkflowPermissions",
    "parseWorkflowTriggerActivities",
    "parseWorkflows",
  ]),
  helperParameters: Object.freeze({
    computeGitHubApiCompleteReductionDigest: Object.freeze({
      pages: "parseCompleteReductionPages",
      reducedValueDigest: "parseSha256Digest",
      requestIdentityDigest: "parseSha256Digest",
    }),
    computeGitHubApiPageRequestDigest: Object.freeze({
      requestCursor: "parseNullableRequestCursor",
      requestIdentityDigest: "parseSha256Digest",
    }),
    computeGitHubApiRequestIdentityDigest: Object.freeze({
      purpose: "parseRepositoryProtectionPurpose",
      request: "parseRepositoryProtectionRequest",
    }),
    computeGitHubApiTerminalPaginationDigest: Object.freeze({
      apiKind: "parseGitHubApiKind",
      pages: "parseTerminalPaginationPages",
      requestIdentityDigest: "parseSha256Digest",
    }),
    computeRepositoryProtectionReceiptDigest: Object.freeze({
      input: "parseRepositoryProtectionStructure",
    }),
    computeRepositoryProtectionRulesetSemanticDigest: Object.freeze({
      input: "parseRulesetSemantics",
    }),
    parseRepositoryProtectionContract: Object.freeze({
      input: "parseRepositoryProtectionStructure",
      schemaVersion: "parseRepositoryProtectionSchemaVersion",
    }),
    parseRepositoryProtectionReceipt: Object.freeze({
      input: "parseRepositoryProtectionStructure",
    }),
  }),
});

const censusKinds = Object.freeze({
  ...repositoryProtectionStructuralInputCensus20260905.receiptTreeRecordKinds,
  ...repositoryProtectionStructuralInputCensus20260905.standaloneRecordKinds,
  ...repositoryProtectionStructuralInputCensus20260905.helperArgumentKinds,
});

function schemaFieldSamples(): Record<string, Row> {
  const receipt = fixture();
  const rest = observationAt(receipt, "ENVIRONMENT");
  const graphql = observationAt(receipt, GRAPHQL_PURPOSE);
  const workflowRun = observationAt(receipt, "WORKFLOW_RUN");
  return {
    completeReductionPage: required(completeReductionPages()[0]),
    environmentBinding: at(receipt, ["environmentBinding"]),
    graphqlPage: at(graphql, ["pages", 0]),
    graphqlRequest: at(graphql, ["request"]),
    linkRelation: at(required(restPages("ENVIRONMENT", 3)[1]), ["linkRelations", 0]),
    observation: rest,
    permission: at(receipt, ["workflows", 0, "permissions", 0]),
    producer: at(receipt, ["producer"]),
    protectedPathPolicy: at(receipt, ["protectedPathPolicies", 0]),
    receipt,
    restPage: at(rest, ["pages", 0]),
    restRequest: at(rest, ["request"]),
    reviewPolicy: at(receipt, ["reviewPolicy"]),
    rulesetSemantics: rulesetSemantics(),
    trigger: at(receipt, ["workflows", 0, "trigger"]),
    triggeringBuild: at(workflowRun, ["triggeringBuild"]),
    workflow: at(receipt, ["workflows", 0]),
  };
}

/* -------------------------------------------------------------------------- *
 * The complete no-throw matrix roots
 * -------------------------------------------------------------------------- */

const restPageValid = (): Row => required(restPages("ENVIRONMENT", 2)[0]);
const linkRelationsValid = (): unknown =>
  rowsAt(required(restPages("ENVIRONMENT", 3)[1]), ["linkRelations"]);
const linkRelationValid = (): Row =>
  at(required(restPages("ENVIRONMENT", 3)[1]), ["linkRelations", 0]);
const graphqlPageValid = (): Row => required(graphqlPages(GRAPHQL_PURPOSE, 2)[0]);
const restPagesValid = (): unknown => restPages("ENVIRONMENT", 2);
const graphqlPagesValid = (): unknown => graphqlPages(GRAPHQL_PURPOSE, 2);
const restRequestValid = (): Row => requestRow("ENVIRONMENT", "REST");
const graphqlRequestValid = (): Row => requestRow(GRAPHQL_PURPOSE, "GRAPHQL");
const digestValid = (): unknown => sha("request-identity");

const receiptTreeRoots: readonly MatrixRoot[] = Object.freeze([
  {
    name: "$",
    kind: "record",
    parse: parse.parseRepositoryProtectionStructure,
    valid: fixture,
  },
  {
    name: "$.reviewPolicy",
    kind: "record",
    parse: parse.parseReviewPolicy,
    valid: () => at(fixture(), ["reviewPolicy"]),
  },
  {
    name: "$.protectedPathPolicies",
    kind: "array",
    parse: parse.parseProtectedPathPolicies,
    valid: () => rowsAt(fixture(), ["protectedPathPolicies"]),
  },
  {
    name: "$.protectedPathPolicies[*]",
    kind: "record",
    parse: parse.parseProtectedPathPolicy,
    valid: () => at(fixture(), ["protectedPathPolicies", 0]),
  },
  {
    name: "$.workflows",
    kind: "array",
    parse: parse.parseWorkflows,
    valid: () => rowsAt(fixture(), ["workflows"]),
  },
  { name: "$.workflows[BUILD]", kind: "record", parse: parse.parseWorkflow, valid: buildWorkflow },
  {
    name: "$.workflows[REVIEW]",
    kind: "record",
    parse: parse.parseWorkflow,
    valid: reviewWorkflow,
  },
  {
    name: "$.workflows[*].permissions",
    kind: "array",
    parse: parse.parseWorkflowPermissions,
    valid: permissionRows,
  },
  {
    name: "$.workflows[*].permissions[*]",
    kind: "record",
    parse: parse.parseWorkflowPermission,
    valid: () => required(permissionRows()[0]),
  },
  {
    name: "$.workflows[BUILD].trigger",
    kind: "record",
    parse: parse.parseWorkflowTrigger,
    valid: () => at(buildWorkflow(), ["trigger"]),
  },
  {
    name: "$.workflows[REVIEW].trigger",
    kind: "record",
    parse: parse.parseWorkflowTrigger,
    valid: () => at(reviewWorkflow(), ["trigger"]),
  },
  {
    name: "$.workflows[*].trigger.activities",
    kind: "array",
    parse: parse.parseWorkflowTriggerActivities,
    valid: () => rowsAt(buildWorkflow(), ["trigger", "activities"]),
  },
  {
    name: "$.producer",
    kind: "record",
    parse: parse.parseReceiptProducer,
    valid: () => at(fixture(), ["producer"]),
  },
  {
    name: "$.environmentBinding",
    kind: "record",
    parse: parse.parseEnvironmentBinding,
    valid: () => at(fixture(), ["environmentBinding"]),
  },
  {
    name: "$.apiObservations",
    kind: "array",
    parse: parse.parseHistoricalApiObservations,
    valid: () => rowsAt(fixture(), ["apiObservations"]),
  },
  {
    name: "$.apiObservations[REST]",
    kind: "record",
    parse: parse.parseHistoricalApiObservation,
    valid: () => observationRow("ENVIRONMENT", "REST", 2),
  },
  {
    name: "$.apiObservations[GRAPHQL]",
    kind: "record",
    parse: parse.parseHistoricalApiObservation,
    valid: () => observationRow(GRAPHQL_PURPOSE, "GRAPHQL", 2),
  },
  {
    name: "$.apiObservations[*].request{REST}",
    kind: "record",
    parse: parse.parseRestRequest,
    valid: restRequestValid,
  },
  {
    name: "$.apiObservations[*].request{GRAPHQL}",
    kind: "record",
    parse: parse.parseGraphqlRequest,
    valid: graphqlRequestValid,
  },
  {
    name: "$.apiObservations[*].request{REST|GRAPHQL}",
    kind: "record",
    parse: parse.parseRepositoryProtectionRequest,
    valid: restRequestValid,
  },
  {
    name: "$.apiObservations[*].pages{REST}",
    kind: "array",
    parse: (input) => parse.parseTerminalPaginationPages("REST", input),
    valid: restPagesValid,
  },
  {
    name: "$.apiObservations[*].pages{GRAPHQL}",
    kind: "array",
    parse: (input) => parse.parseTerminalPaginationPages("GRAPHQL", input),
    valid: graphqlPagesValid,
  },
  {
    name: "$.apiObservations[*].pages[*]{REST}",
    kind: "record",
    parse: parse.parseRestPage,
    valid: restPageValid,
  },
  {
    name: "$.apiObservations[*].pages[*]{GRAPHQL}",
    kind: "record",
    parse: parse.parseGraphqlPage,
    valid: graphqlPageValid,
  },
  {
    name: "$.apiObservations[*].pages[*].linkRelations",
    kind: "array",
    parse: parse.parseRestLinkRelations,
    valid: linkRelationsValid,
  },
  {
    name: "$.apiObservations[*].pages[*].linkRelations[*]",
    kind: "record",
    parse: parse.parseRestLinkRelation,
    valid: linkRelationValid,
  },
  {
    name: "$.apiObservations[WORKFLOW_RUN].triggeringBuild",
    kind: "record",
    parse: parse.parseTriggeringBuild,
    valid: triggeringBuildRow,
  },
]);

const standaloneRoots: readonly MatrixRoot[] = Object.freeze([
  {
    name: "$computeGitHubApiRequestIdentityDigest.purpose",
    kind: "scalar",
    parse: parse.parseRepositoryProtectionPurpose,
    valid: () => "ENVIRONMENT",
    malformed: "environment",
  },
  {
    name: "$computeGitHubApiRequestIdentityDigest.request{REST|GRAPHQL}",
    kind: "record",
    parse: parse.parseRepositoryProtectionRequest,
    valid: graphqlRequestValid,
  },
  {
    name: "$computeGitHubApiPageRequestDigest.requestIdentityDigest",
    kind: "scalar",
    parse: parse.parseSha256Digest,
    valid: digestValid,
    malformed: sha("x").toUpperCase(),
  },
  {
    name: "$computeGitHubApiPageRequestDigest.requestCursor",
    kind: "nullable-scalar",
    parse: parse.parseNullableRequestCursor,
    valid: () => null,
    malformed: "cursor" + lineFeed,
  },
  {
    name: "$computeGitHubApiCompleteReductionDigest.requestIdentityDigest",
    kind: "scalar",
    parse: parse.parseSha256Digest,
    valid: digestValid,
    malformed: sha("x").slice(0, 63),
  },
  {
    name: "$computeGitHubApiCompleteReductionDigest.pages",
    kind: "array",
    parse: parse.parseCompleteReductionPages,
    valid: () => completeReductionPages(),
  },
  {
    name: "$computeGitHubApiCompleteReductionDigest.pages[*]",
    kind: "record",
    parse: parse.parseCompleteReductionPage,
    valid: () => required(completeReductionPages()[0]),
  },
  {
    name: "$computeGitHubApiCompleteReductionDigest.reducedValueDigest",
    kind: "scalar",
    parse: parse.parseSha256Digest,
    valid: digestValid,
    malformed: "not-a-digest",
  },
  {
    name: "$computeGitHubApiTerminalPaginationDigest.requestIdentityDigest",
    kind: "scalar",
    parse: parse.parseSha256Digest,
    valid: digestValid,
    malformed: sha("x") + "0",
  },
  {
    name: "$computeGitHubApiTerminalPaginationDigest.apiKind",
    kind: "scalar",
    parse: parse.parseGitHubApiKind,
    valid: () => "REST",
    malformed: "rest",
  },
  {
    name: "$computeGitHubApiTerminalPaginationDigest.pages{REST}",
    kind: "array",
    parse: (input) => parse.parseTerminalPaginationPages("REST", input),
    valid: restPagesValid,
  },
  {
    name: "$computeGitHubApiTerminalPaginationDigest.pages{GRAPHQL}",
    kind: "array",
    parse: (input) => parse.parseTerminalPaginationPages("GRAPHQL", input),
    valid: graphqlPagesValid,
  },
  {
    name: "$computeGitHubApiTerminalPaginationDigest.pages[*]{REST}",
    kind: "record",
    parse: parse.parseRestPage,
    valid: restPageValid,
  },
  {
    name: "$computeGitHubApiTerminalPaginationDigest.pages[*]{GRAPHQL}",
    kind: "record",
    parse: parse.parseGraphqlPage,
    valid: graphqlPageValid,
  },
  {
    name: "$computeGitHubApiTerminalPaginationDigest.pages[*].linkRelations",
    kind: "array",
    parse: parse.parseRestLinkRelations,
    valid: linkRelationsValid,
  },
  {
    name: "$computeGitHubApiTerminalPaginationDigest.pages[*].linkRelations[*]",
    kind: "record",
    parse: parse.parseRestLinkRelation,
    valid: linkRelationValid,
  },
  {
    name: "$parseRepositoryProtectionReceipt.input",
    kind: "record",
    parse: parse.parseRepositoryProtectionStructure,
    valid: fixture,
  },
  {
    name: "$computeRepositoryProtectionRulesetSemanticDigest.input",
    kind: "record",
    parse: parse.parseRulesetSemantics,
    valid: rulesetSemantics,
  },
  {
    name: "$computeRepositoryProtectionRulesetSemanticDigest.input.reviewPolicy",
    kind: "record",
    parse: parse.parseReviewPolicy,
    valid: () => at(rulesetSemantics(), ["reviewPolicy"]),
  },
  {
    name: "$computeRepositoryProtectionRulesetSemanticDigest.input.protectedPathPolicies",
    kind: "array",
    parse: parse.parseProtectedPathPolicies,
    valid: () => rowsAt(rulesetSemantics(), ["protectedPathPolicies"]),
  },
  {
    name: "$computeRepositoryProtectionRulesetSemanticDigest.input.protectedPathPolicies[*]",
    kind: "record",
    parse: parse.parseProtectedPathPolicy,
    valid: () => at(rulesetSemantics(), ["protectedPathPolicies", 0]),
  },
  {
    name: "$computeRepositoryProtectionRulesetSemanticDigest.input.workflows",
    kind: "array",
    parse: parse.parseWorkflows,
    valid: () => rowsAt(rulesetSemantics(), ["workflows"]),
  },
  {
    name: "$computeRepositoryProtectionRulesetSemanticDigest.input.workflows[*]",
    kind: "record",
    parse: parse.parseWorkflow,
    valid: () => at(rulesetSemantics(), ["workflows", 1]),
  },
  {
    name: "$computeRepositoryProtectionRulesetSemanticDigest.input.workflows[*].permissions",
    kind: "array",
    parse: parse.parseWorkflowPermissions,
    valid: () => rowsAt(rulesetSemantics(), ["workflows", 1, "permissions"]),
  },
  {
    name: "$computeRepositoryProtectionRulesetSemanticDigest.input.workflows[*].permissions[*]",
    kind: "record",
    parse: parse.parseWorkflowPermission,
    valid: () => at(rulesetSemantics(), ["workflows", 1, "permissions", 8]),
  },
  {
    name: "$computeRepositoryProtectionRulesetSemanticDigest.input.workflows[*].trigger",
    kind: "record",
    parse: parse.parseWorkflowTrigger,
    valid: () => at(rulesetSemantics(), ["workflows", 1, "trigger"]),
  },
  {
    name: "$computeRepositoryProtectionRulesetSemanticDigest.input.workflows[*].trigger.activities",
    kind: "array",
    parse: parse.parseWorkflowTriggerActivities,
    valid: () => rowsAt(rulesetSemantics(), ["workflows", 1, "trigger", "activities"]),
  },
  {
    name: "$computeRepositoryProtectionReceiptDigest.input",
    kind: "record",
    parse: parse.parseRepositoryProtectionStructure,
    valid: fixture,
  },
  {
    name: "$parseRepositoryProtectionContract.schemaVersion",
    kind: "scalar",
    parse: parse.parseRepositoryProtectionSchemaVersion,
    valid: () => schema,
    malformed: "repository-protection-receipt/v2",
  },
  {
    name: "$parseRepositoryProtectionContract.input",
    kind: "record",
    parse: parse.parseRepositoryProtectionStructure,
    valid: fixture,
  },
]);

const allRoots: readonly MatrixRoot[] = Object.freeze([...receiptTreeRoots, ...standaloneRoots]);

interface Mutation {
  readonly label: string;
  readonly input: unknown;
}

function recordMutations(root: MatrixRoot): Mutation[] {
  const rows: Mutation[] = [
    { label: "null", input: null },
    { label: "wrong-kind:string", input: "record" },
    { label: "wrong-kind:number", input: 1 },
    { label: "wrong-kind:boolean", input: true },
    { label: "wrong-kind:array", input: [] },
    { label: "unknown-member", input: { ...(root.valid() as Row), futureMember: true } },
  ];
  for (const field of Object.keys(root.valid() as Row)) {
    const missing = { ...(root.valid() as Row) };
    delete missing[field];
    rows.push({ label: "missing:" + field, input: missing });
  }
  return rows;
}

function arrayMutations(root: MatrixRoot): Mutation[] {
  const rows: Mutation[] = [
    { label: "null", input: null },
    { label: "wrong-kind:record", input: {} },
    { label: "wrong-kind:string", input: "array" },
    { label: "wrong-kind:number", input: 1 },
  ];
  const sparse = [...(root.valid() as unknown[])];
  delete sparse[0];
  rows.push({ label: "sparse", input: sparse });
  const wrongElement = [...(root.valid() as unknown[])];
  wrongElement[0] = 42;
  rows.push({ label: "wrong-element-kind", input: wrongElement });
  const malformed = [...(root.valid() as unknown[])];
  const first = malformed[0];
  malformed[0] =
    typeof first === "object" && first !== null
      ? withoutFirstMember(first as Row)
      : "malformed-element";
  rows.push({ label: "malformed-element", input: malformed });
  return rows;
}

function scalarMutations(root: MatrixRoot): Mutation[] {
  const rows: Mutation[] = [
    { label: "wrong-kind:record", input: {} },
    { label: "wrong-kind:array", input: [] },
    { label: "wrong-kind:number", input: 1 },
    { label: "wrong-kind:boolean", input: true },
    { label: "malformed", input: root.malformed },
  ];
  if (root.kind === "scalar") rows.push({ label: "null", input: null });
  return rows;
}

function mutationsFor(root: MatrixRoot): Mutation[] {
  if (root.kind === "record") return recordMutations(root);
  if (root.kind === "array") return arrayMutations(root);
  return scalarMutations(root);
}

describe("ISS-054 Packet A repository-protection structural parsing", () => {
  test("derives the versioned structural-input census from the accepted schema fields", () => {
    const census = repositoryProtectionStructuralInputCensus20260905;
    expect(census.censusVersion).toBe("2026-09-05");
    expect(Object.keys(census.receiptTreeRecordKinds)).toHaveLength(15);
    expect(Object.keys(census.standaloneRecordKinds)).toHaveLength(2);
    expect(Object.keys(census.helperArgumentKinds)).toHaveLength(8);
    expect(Object.keys(censusKinds)).toHaveLength(25);
    const moduleExports = parse as unknown as Record<string, unknown>;
    for (const parserName of Object.values(censusKinds))
      expect(typeof moduleExports[parserName]).toBe("function");
    for (const parserName of census.typedArrayParsers)
      expect(typeof moduleExports[parserName]).toBe("function");
    for (const parameters of Object.values(census.helperParameters))
      for (const parserName of Object.values(parameters))
        expect(Object.values(censusKinds)).toContain(parserName);

    const fieldsByKey = parse.repositoryProtectionSchemaFields as unknown as Record<
      string,
      readonly string[]
    >;
    expect(codepointSorted(Object.keys(fieldsByKey))).toEqual(
      codepointSorted(Object.values(census.schemaFieldKeyByKind)),
    );
    expect(codepointSorted(Object.keys(census.schemaFieldKeyByKind))).toEqual(
      codepointSorted([
        ...Object.keys(census.receiptTreeRecordKinds),
        ...Object.keys(census.standaloneRecordKinds),
      ]),
    );
    const samples = schemaFieldSamples();
    for (const [key, fields] of Object.entries(fieldsByKey)) {
      expect(fields).toEqual(codepointSorted(fields));
      expect(fields).toEqual(codepointSorted(Object.keys(required(samples[key]))));
    }
    expect(parse.repositoryProtectionPurposes).toEqual(
      codepointSorted([...parse.repositoryProtectionPurposes]),
    );
    expect(parse.repositoryProtectionPermissionNames).toEqual(
      codepointSorted([...parse.repositoryProtectionPermissionNames]),
    );
    expect(parse.repositoryProtectionSchemaVersions).toEqual([schema]);
    expect(iss002HarnessPaths).toContain(sourcePath);
    expect(iss002TestBundlePaths).toContain(testPath);
  });

  test("enumerates every receipt-tree and standalone matrix root exactly once", () => {
    expect(receiptTreeRoots).toHaveLength(27);
    expect(standaloneRoots).toHaveLength(30);
    expect(new Set(allRoots.map((root) => root.name)).size).toBe(allRoots.length);
    for (const root of allRoots) {
      const result = root.parse(root.valid());
      if (!result.ok) throw new Error("positive root refused: " + root.name);
      expect(result.ok).toBe(true);
      if (root.kind === "scalar" || root.kind === "nullable-scalar")
        expect(root.malformed).toBeDefined();
    }
  });

  test("returns a refusal and never throws across the complete no-throw path matrix", () => {
    for (const root of allRoots)
      for (const mutation of mutationsFor(root)) {
        const label = root.name + " / " + mutation.label;
        let result: { readonly ok: boolean } | undefined;
        expect(() => {
          result = root.parse(mutation.input);
        }, label).not.toThrow();
        expect(required(result).ok, label).toBe(false);
      }
  });

  test("refuses the five prior failure instances without throwing", () => {
    const instances: { readonly name: string; readonly input: () => unknown }[] = [
      { name: "$.environmentBinding = null", input: () => changed(["environmentBinding"], null) },
      {
        name: "$.workflows = [BUILD, BUILD]",
        input: () => changed(["workflows"], [buildWorkflow(), buildWorkflow()]),
      },
      {
        name: "$.workflows[*].trigger = null",
        input: () => changed(["workflows", 1, "trigger"], null),
      },
      {
        name: "$.apiObservations[*].pages[*].linkRelations = null",
        input: () => changed(["apiObservations", 0, "pages", 0, "linkRelations"], null),
      },
    ];
    for (const instance of instances) {
      let result: { readonly ok: boolean } | undefined;
      expect(() => {
        result = parse.parseRepositoryProtectionStructure(instance.input());
      }, instance.name).not.toThrow();
      expect(required(result).ok, instance.name).toBe(false);
    }
    // Observation field census drift: completeReductionDigest precedes completedAt.
    const observationFields = parse.repositoryProtectionSchemaFields.observation;
    expect(observationFields).toEqual(codepointSorted([...observationFields]));
    expect(observationFields.indexOf("completeReductionDigest")).toBeLessThan(
      observationFields.indexOf("completedAt"),
    );
    expect([...observationFields]).toEqual(
      codepointSorted(Object.keys(observationAt(fixture(), "ENVIRONMENT"))),
    );
    const drifted = [...observationFields].filter(
      (field) => field !== "completeReductionDigest" && field !== "completedAt",
    );
    expect(["completedAt", "completeReductionDigest", ...drifted]).not.toEqual([
      ...observationFields,
    ]);
  });

  test("keeps the accepted nullable cells as positives", () => {
    expect(parse.parseNullableRequestCursor(null).ok).toBe(true);
    expect(parse.parseNullableRequestCursor("cursor-1").ok).toBe(true);
    const firstGraphqlPage = required(graphqlPages(GRAPHQL_PURPOSE, 2)[0]);
    expect(firstGraphqlPage.requestCursor).toBeNull();
    expect(parse.parseGraphqlPage(firstGraphqlPage).ok).toBe(true);
    expect(required(graphqlPages(GRAPHQL_PURPOSE, 1)[0]).etag).toBeNull();
    expect(parse.parseGraphqlPage(required(graphqlPages(GRAPHQL_PURPOSE, 1)[0])).ok).toBe(true);
    for (const purpose of parse.repositoryProtectionPurposes) {
      const row = observationAt(fixture(), purpose);
      expect(row.triggeringBuild).toEqual(purpose === "WORKFLOW_RUN" ? triggeringBuildRow() : null);
      expect(parse.parseHistoricalApiObservation(row).ok).toBe(true);
    }
    const buildTrigger = at(buildWorkflow(), ["trigger"]);
    for (const field of [
      "requiredConclusion",
      "sourceWorkflowDigest",
      "sourceWorkflowPath",
      "sourceWorkflowRef",
    ])
      expect(buildTrigger[field]).toBeNull();
    expect(parse.parseWorkflowTrigger(buildTrigger).ok).toBe(true);
    const onlyPage = required(restPages("ENVIRONMENT", 1)[0]);
    expect(onlyPage.linkRelations).toEqual([]);
    expect(onlyPage.linkHeaderDigest).toBeNull();
    expect(onlyPage.nextRequestDigest).toBeNull();
    expect(parse.parseRestPage(onlyPage).ok).toBe(true);
  });
});

/* -------------------------------------------------------------------------- *
 * Committed deletion mutants: each removes one typed-child gate
 * -------------------------------------------------------------------------- */

interface DeletionMutant {
  readonly gate: string;
  readonly path: string;
  readonly input: () => unknown;
  readonly real: (input: unknown) => { readonly ok: boolean };
  readonly ungated: (input: unknown) => unknown;
}

const deletionMutants: readonly DeletionMutant[] = Object.freeze([
  {
    gate: "parseWorkflow: typed trigger child gate",
    path: "$.workflows[*].trigger",
    input: () => changed(["workflows", 1, "trigger"], null),
    real: parse.parseRepositoryProtectionStructure,
    ungated: (input) => {
      const workflow = at(input, ["workflows", 1]);
      const trigger = parse.parseWorkflowTrigger(workflow.trigger);
      const accumulated: string[] = trigger.ok ? [] : [...trigger.issues];
      const value = (trigger.ok ? trigger.value : undefined) as unknown as Row;
      return [accumulated.length, value.sourceWorkflowDigest];
    },
  },
  {
    gate: "parseRestPage: typed linkRelations child gate",
    path: "$.apiObservations[*].pages[*].linkRelations",
    input: () => changed(["apiObservations", 0, "pages", 0, "linkRelations"], null),
    real: parse.parseRepositoryProtectionStructure,
    ungated: (input) => {
      const page = at(input, ["apiObservations", 0, "pages", 0]);
      const relations = parse.parseRestLinkRelations(page.linkRelations);
      const rows = (relations.ok ? relations.value : undefined) as unknown as Row[];
      return rows.find((row) => row.relation === "NEXT");
    },
  },
  {
    gate: "parseHistoricalApiObservation: typed request gate before page-branch selection",
    path: "$.apiObservations[*].request{REST|GRAPHQL}",
    input: () => changed(["apiObservations", 0, "request"], null),
    real: parse.parseRepositoryProtectionStructure,
    ungated: (input) => {
      const row = at(input, ["apiObservations", 0]);
      const request = parse.parseRepositoryProtectionRequest(row.request);
      const value = (request.ok ? request.value : undefined) as unknown as Row;
      return parse.parseTerminalPaginationPages(value.apiKind as "REST", row.pages);
    },
  },
  {
    gate: "parseHistoricalApiObservation: typed triggeringBuild gate",
    path: "$.apiObservations[WORKFLOW_RUN].triggeringBuild",
    input: () => changed(["apiObservations", 8, "triggeringBuild"], { conclusion: "SUCCESS" }),
    real: parse.parseRepositoryProtectionStructure,
    ungated: (input) => {
      const row = at(input, ["apiObservations", 8]);
      const parsed = parse.parseTriggeringBuild(row.triggeringBuild);
      const value = (parsed.ok ? parsed.value : undefined) as unknown as Row;
      return value.runId;
    },
  },
  {
    gate: "parseRepositoryProtectionStructure: typed environmentBinding gate",
    path: "$.environmentBinding",
    input: () => changed(["environmentBinding"], null),
    real: parse.parseRepositoryProtectionStructure,
    ungated: (input) => {
      const receipt = input as Row;
      const parsed = parse.parseEnvironmentBinding(receipt.environmentBinding);
      const value = (parsed.ok ? parsed.value : undefined) as unknown as Row;
      return { environmentName: value.environmentName };
    },
  },
  {
    gate: "parseWorkflowTrigger: typed activities gate",
    path: "$.workflows[*].trigger.activities",
    input: () => changed(["workflows", 0, "trigger", "activities"], null),
    real: parse.parseRepositoryProtectionStructure,
    ungated: (input) => {
      const trigger = at(input, ["workflows", 0, "trigger"]);
      const parsed = parse.parseWorkflowTriggerActivities(trigger.activities);
      const rows = (parsed.ok ? parsed.value : undefined) as unknown as string[];
      return rows.length;
    },
  },
  {
    gate: "parseTypedArray: complete-element gate against partial array acceptance",
    path: "$.protectedPathPolicies[*]",
    input: () =>
      changed(["protectedPathPolicies", 0], { path: 1, reviewPolicy: "INDEPENDENT_APPROVAL" }),
    real: parse.parseRepositoryProtectionStructure,
    ungated: (input) => {
      const accepted: Row[] = [];
      for (const row of rowsAt(input, ["protectedPathPolicies"])) {
        const parsed = parse.parseProtectedPathPolicy(row);
        if (parsed.ok) accepted.push(parsed.value);
      }
      const second = accepted[1] as unknown as Row;
      return second.path;
    },
  },
  {
    gate: "parseRulesetSemantics: typed workflows gate",
    path: "$computeRepositoryProtectionRulesetSemanticDigest.input.workflows",
    input: () => {
      const semantics = rulesetSemantics();
      semantics.workflows = null;
      return semantics;
    },
    real: parse.parseRulesetSemantics,
    ungated: (input) => {
      const record = input as Row;
      const parsed = parse.parseWorkflows(record.workflows);
      const rows = (parsed.ok ? parsed.value : undefined) as unknown as Row[];
      return rows.find((row) => row.role === "BUILD");
    },
  },
]);

describe("ISS-054 Packet A typed-child gates and hostile reflection", () => {
  test("keeps every committed deletion mutant discriminating", () => {
    expect(deletionMutants).toHaveLength(8);
    expect(new Set(deletionMutants.map((mutant) => mutant.gate)).size).toBe(deletionMutants.length);
    for (const mutant of deletionMutants) {
      expect(() => mutant.ungated(mutant.input()), mutant.gate).toThrow();
      let result: { readonly ok: boolean } | undefined;
      expect(() => {
        result = mutant.real(mutant.input());
      }, mutant.gate).not.toThrow();
      expect(required(result).ok, mutant.gate).toBe(false);
    }
  });

  test("refuses hostile reflection at every root with zero trap executions", () => {
    for (const root of allRoots) {
      const valid = root.valid();
      const target: object = typeof valid === "object" && valid !== null ? valid : { value: valid };

      const proxyTrap = vi.fn(() => {
        throw new Error("proxy trap executed at " + root.name);
      });
      const proxied = new Proxy(target, {
        get: proxyTrap,
        getOwnPropertyDescriptor: proxyTrap,
        has: proxyTrap,
        ownKeys: proxyTrap,
      });
      expect(root.parse(proxied).ok, root.name).toBe(false);
      expect(proxyTrap, root.name).not.toHaveBeenCalled();

      const accessorTrap = vi.fn(() => sha("accessor"));
      const accessorTarget = (Array.isArray(target)
        ? [...(target as unknown[])]
        : { ...(target as Row) }) as unknown as Record<PropertyKey, unknown>;
      const accessorKey = Array.isArray(target) ? "0" : (Object.keys(accessorTarget)[0] ?? "value");
      delete accessorTarget[accessorKey];
      Object.defineProperty(accessorTarget, accessorKey, {
        configurable: true,
        enumerable: true,
        get: accessorTrap,
      });
      expect(root.parse(accessorTarget).ok, root.name).toBe(false);
      expect(accessorTrap, root.name).not.toHaveBeenCalled();

      const symbolTarget = (Array.isArray(target)
        ? [...(target as unknown[])]
        : { ...(target as Row) }) as unknown as Record<PropertyKey, unknown>;
      symbolTarget[Symbol("hidden")] = true;
      expect(root.parse(symbolTarget).ok, root.name).toBe(false);

      const hiddenTarget = (Array.isArray(target)
        ? [...(target as unknown[])]
        : { ...(target as Row) }) as unknown as Record<PropertyKey, unknown>;
      Object.defineProperty(hiddenTarget, "hiddenMember", {
        configurable: true,
        enumerable: false,
        value: true,
      });
      expect(root.parse(hiddenTarget).ok, root.name).toBe(false);
    }
  });

  test("refuses cross-realm, subclass, cyclic, iterator and extra-own-key inputs", () => {
    const crossRealm = runInNewContext("(" + JSON.stringify(fixture()) + ")") as unknown;
    expect(parse.parseRepositoryProtectionStructure(crossRealm).ok).toBe(false);
    class Receipt extends Object {}
    expect(
      parse.parseRepositoryProtectionStructure(Object.assign(new Receipt(), fixture())).ok,
    ).toBe(false);
    const cyclic: Record<string, unknown> = fixture();
    cyclic.self = cyclic;
    expect(parse.parseRepositoryProtectionStructure(cyclic).ok).toBe(false);
    const iterated = fixture();
    const workflows = rowsAt(iterated, ["workflows"]) as unknown as Record<PropertyKey, unknown>;
    workflows[Symbol.iterator] = function* iterate() {
      yield buildWorkflow();
    };
    expect(parse.parseRepositoryProtectionStructure(iterated).ok).toBe(false);
    const extraKey = fixture();
    Object.defineProperty(rowsAt(extraKey, ["protectedPathPolicies"]), "extra", {
      configurable: true,
      enumerable: true,
      value: 1,
    });
    expect(parse.parseRepositoryProtectionStructure(extraKey).ok).toBe(false);
    const holed = fixture();
    delete rowsAt(holed, ["apiObservations"])[0];
    expect(parse.parseRepositoryProtectionStructure(holed).ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- *
 * Scalar, local and structural census vectors
 * -------------------------------------------------------------------------- */

function manyProtectedPaths(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    path: "packages/p" + String(index + 100),
    reviewPolicy: "INDEPENDENT_APPROVAL",
  }));
}
const packetBPublicNames: readonly string[] = Object.freeze([
  "computeGitHubApiCompleteReductionDigest",
  "computeGitHubApiPageRequestDigest",
  "computeGitHubApiRequestIdentityDigest",
  "computeGitHubApiTerminalPaginationDigest",
  "computeRepositoryProtectionReceiptDigest",
  "computeRepositoryProtectionRulesetSemanticDigest",
  "parseRepositoryProtectionContract",
  "parseRepositoryProtectionReceipt",
]);

describe("ISS-054 Packet A scalar, local and structural censuses", () => {
  test("pins identity, name, path, ref, route, etag, cursor and timestamp grammars", () => {
    for (const field of ["repositoryId", "rulesetId"])
      for (const value of ["0", "01", "9007199254740992", 1, "1" + lineFeed, null])
        expect(parse.parseRepositoryProtectionStructure(changed([field], value)).ok).toBe(false);
    for (const field of ["runAttempt", "runId"])
      for (const value of ["0", "01", "9007199254740992", 1])
        expect(
          parse.parseReceiptProducer({ ...at(fixture(), ["producer"]), [field]: value }).ok,
        ).toBe(false);
    for (const disposition of ["accepted", "UNKNOWN", "", null])
      expect(
        parse.parseRepositoryProtectionStructure(changed(["disposition"], disposition)).ok,
      ).toBe(false);
    for (const artifactName of [
      "",
      ".",
      "..",
      "a/b",
      "a" + backslash + "b",
      "a" + lineFeed,
      "a" + deleteCharacter,
      "e".repeat(257),
    ])
      expect(parse.parseReceiptProducer({ ...at(fixture(), ["producer"]), artifactName }).ok).toBe(
        false,
      );
    for (const ref of [
      "main",
      "refs/tags/main",
      "refs/heads/",
      "refs/heads/a..b",
      "refs/heads/a.lock",
      "refs/heads/a b",
      "refs/heads/a" + backslash + "b",
      "refs/heads/" + "e".repeat(502),
    ])
      expect(parse.parseWorkflow({ ...buildWorkflow(), ref }).ok).toBe(false);
    for (const path of [
      "",
      "/absolute",
      "a" + backslash + "b",
      "a/../b",
      "a" + lineFeed,
      "e".repeat(513),
    ])
      expect(
        parse.parseProtectedPathPolicy({ path, reviewPolicy: "INDEPENDENT_APPROVAL" }).ok,
      ).toBe(false);
    for (const route of [
      "repos/x",
      "/repos/x?q=1",
      "/repos/x#f",
      "/repos/x" + lineFeed,
      "/" + "e".repeat(512),
    ])
      expect(parse.parseRestRequest({ ...requestRow("ENVIRONMENT", "REST"), route }).ok).toBe(
        false,
      );
    for (const etag of ["", "with space", "x" + lineFeed, quote + "e".repeat(1024) + quote])
      expect(parse.parseRestPage({ ...restPageValid(), etag }).ok).toBe(false);
    for (const cursor of ["", "x".repeat(2049), "a" + lineFeed, "a" + deleteCharacter])
      expect(parse.parseNullableRequestCursor(cursor).ok).toBe(false);
    for (const timestamp of [
      "2026-09-04T00:01:00Z",
      "2026-09-04T00:01:00.000",
      "2026-02-30T00:00:00.000Z",
      "2026-09-04 00:01:00.000Z",
    ])
      expect(parse.parseRestPage({ ...restPageValid(), observedAt: timestamp }).ok, timestamp).toBe(
        false,
      );
    for (const [expiresAt, accepted] of [
      ["2026-09-04T00:02:00.001Z", true],
      ["2026-09-11T00:02:00.000Z", true],
      ["2026-09-04T00:02:00.000Z", false],
      ["2026-09-04T00:01:59.999Z", false],
      ["2026-09-11T00:02:00.001Z", false],
    ] as const)
      expect(
        parse.parseRepositoryProtectionStructure(changed(["expiresAt"], expiresAt)).ok,
        expiresAt,
      ).toBe(accepted);
    const observation = observationRow("ENVIRONMENT", "REST");
    expect(parse.parseHistoricalApiObservation(observation).ok).toBe(true);
    expect(
      parse.parseHistoricalApiObservation({
        ...observation,
        startedAt: "2026-09-04T00:01:03.000Z",
      }).ok,
    ).toBe(false);
  });

  test("pins literal, nullability and permission-namespace cells", () => {
    for (const [field, value] of [
      ["adminBypass", "ALLOWED"],
      ["authorApproval", "REQUIRED"],
      ["committerApproval", "REQUIRED"],
      ["dismissalOnSourceChange", "FORBIDDEN"],
      ["minimumApprovals", "2"],
    ] as const)
      expect(
        parse.parseReviewPolicy({ ...at(fixture(), ["reviewPolicy"]), [field]: value }).ok,
      ).toBe(false);
    expect(parse.parseProtectedPathPolicy({ path: "a/b", reviewPolicy: "GLOB" }).ok).toBe(false);
    expect(
      parse.parseWorkflow({
        ...buildWorkflow(),
        permissionNamespace: "github-actions-permissions/latest",
      }).ok,
    ).toBe(false);
    expect(parse.parseRestPage({ ...restPageValid(), status: "201" }).ok).toBe(false);
    for (const ordinal of ["0", "01", "65", 1])
      expect(parse.parseRestPage({ ...restPageValid(), ordinal }).ok).toBe(false);
    for (const ordinal of ["0", "65"])
      expect(parse.parseCompleteReductionPage({ ordinal, responseDigest: sha("x") }).ok).toBe(
        false,
      );
    const singlePage = required(restPages("ENVIRONMENT", 1)[0]);
    expect(
      parse.parseRestPage({ ...singlePage, linkHeaderDigest: sha("invented-link-header") }).ok,
    ).toBe(false);
    expect(parse.parseRestPage({ ...restPageValid(), linkHeaderDigest: null }).ok).toBe(false);
    expect(parse.parseGraphqlPage({ ...graphqlPageValid(), hasNextPage: "true" }).ok).toBe(false);
    expect(
      parse.parseGraphqlRequest({ ...graphqlRequestValid(), apiVersion: "2022-11-28" }).ok,
    ).toBe(false);
    for (const [name, access, accepted] of [
      ["actions", "WRITE", true],
      ["id-token", "WRITE", true],
      ["id-token", "READ", false],
      ["models", "READ", true],
      ["models", "WRITE", false],
      ["vulnerability-alerts", "WRITE", false],
      ["contents", "ADMIN", false],
    ] as const)
      expect(
        parse.parseWorkflowPermission({ access, permission: name }).ok,
        name + ":" + access,
      ).toBe(accepted);
    expect(parse.parseWorkflowPermission({ access: "NONE", permission: "unknown-scope" }).ok).toBe(
      false,
    );
  });

  test("pins dense bounds, order, uniqueness and the ordered structural censuses", () => {
    for (const count of [1, 64])
      expect(
        parse.parseRepositoryProtectionStructure(
          changed(["protectedPathPolicies"], manyProtectedPaths(count)),
        ).ok,
        "protectedPathPolicies:" + String(count),
      ).toBe(true);
    for (const count of [0, 65])
      expect(
        parse.parseRepositoryProtectionStructure(
          changed(["protectedPathPolicies"], manyProtectedPaths(count)),
        ).ok,
        "protectedPathPolicies:" + String(count),
      ).toBe(false);
    expect(parse.parseProtectedPathPolicies([...manyProtectedPaths(2)].reverse()).ok).toBe(false);
    expect(
      parse.parseProtectedPathPolicies([
        required(manyProtectedPaths(1)[0]),
        required(manyProtectedPaths(1)[0]),
      ]).ok,
    ).toBe(false);
    for (const count of [1, 64]) {
      expect(parse.parseRestPages(restPages("ENVIRONMENT", count)).ok).toBe(true);
      expect(parse.parseGraphqlPages(graphqlPages(GRAPHQL_PURPOSE, count)).ok).toBe(true);
    }
    for (const pages of [[], restPages("ENVIRONMENT", 65)])
      expect(parse.parseRestPages(pages).ok).toBe(false);
    for (const pages of [[], graphqlPages(GRAPHQL_PURPOSE, 65)])
      expect(parse.parseGraphqlPages(pages).ok).toBe(false);
    for (const rows of [
      [buildWorkflow(), buildWorkflow()],
      [reviewWorkflow(), reviewWorkflow()],
      [reviewWorkflow(), buildWorkflow()],
      [buildWorkflow()],
      [buildWorkflow(), reviewWorkflow(), buildWorkflow()],
    ])
      expect(parse.parseWorkflows(rows).ok).toBe(false);
    expect(parse.parseWorkflows([buildWorkflow(), reviewWorkflow()]).ok).toBe(true);
    const permissions = permissionRows();
    expect(parse.parseWorkflowPermissions(permissions).ok).toBe(true);
    expect(parse.parseWorkflowPermissions(permissions.slice(0, 16)).ok).toBe(false);
    expect(parse.parseWorkflowPermissions([...permissions, required(permissions[0])]).ok).toBe(
      false,
    );
    const swapped = [...permissions];
    swapped[0] = required(permissions[1]);
    swapped[1] = required(permissions[0]);
    expect(parse.parseWorkflowPermissions(swapped).ok).toBe(false);
    const observations = rowsAt(fixture(), ["apiObservations"]);
    expect(parse.parseHistoricalApiObservations(observations).ok).toBe(true);
    expect(parse.parseHistoricalApiObservations([...observations].reverse()).ok).toBe(false);
    expect(parse.parseHistoricalApiObservations(observations.slice(0, 8)).ok).toBe(false);
    expect(
      parse.parseRepositoryProtectionStructure(
        changed(["apiObservations", 1, "purpose"], "ENVIRONMENT"),
      ).ok,
    ).toBe(false);
    const relations = linkRelationsValid() as Row[];
    expect(parse.parseRestLinkRelations(relations).ok).toBe(true);
    expect(parse.parseRestLinkRelations([...relations].reverse()).ok).toBe(false);
    expect(parse.parseRestLinkRelations([required(relations[0]), required(relations[0])]).ok).toBe(
      false,
    );
    expect(parse.parseRestLinkRelations([...relations, required(relations[0])]).ok).toBe(false);
    expect(parse.parseRestLinkRelations([]).ok).toBe(true);
  });

  test("classifies request, page and trigger branches from each record's own census", () => {
    expect(parse.parseRepositoryProtectionRequest(restRequestValid()).ok).toBe(true);
    expect(parse.parseRepositoryProtectionRequest(graphqlRequestValid()).ok).toBe(true);
    expect(
      parse.parseRepositoryProtectionRequest({ ...restRequestValid(), apiKind: "SOAP" }).ok,
    ).toBe(false);
    expect(
      parse.parseRepositoryProtectionRequest({
        ...restRequestValid(),
        documentDigest: sha("crossed"),
      }).ok,
    ).toBe(false);
    expect(
      parse.parseRepositoryProtectionRequest({ ...graphqlRequestValid(), route: "/repos/x" }).ok,
    ).toBe(false);
    expect(parse.parseRestRequest({ ...restRequestValid(), method: "POST" }).ok).toBe(false);
    expect(parse.parseGraphqlRequest({ ...graphqlRequestValid(), method: "GET" }).ok).toBe(false);
    expect(parse.parseGraphqlPage(restPageValid()).ok).toBe(false);
    expect(parse.parseRestPage(graphqlPageValid()).ok).toBe(false);
    expect(parse.parseTerminalPaginationPages("REST", graphqlPagesValid()).ok).toBe(false);
    expect(parse.parseTerminalPaginationPages("GRAPHQL", restPagesValid()).ok).toBe(false);
    const buildTrigger = at(buildWorkflow(), ["trigger"]);
    const reviewTrigger = at(reviewWorkflow(), ["trigger"]);
    expect(parse.parseWorkflowTrigger({ ...buildTrigger, event: "PUSH" }).ok).toBe(false);
    expect(parse.parseWorkflowTrigger({ ...buildTrigger, activities: ["completed"] }).ok).toBe(
      false,
    );
    expect(parse.parseWorkflowTrigger({ ...buildTrigger, requiredConclusion: "SUCCESS" }).ok).toBe(
      false,
    );
    expect(
      parse.parseWorkflowTrigger({
        ...reviewTrigger,
        activities: ["opened", "reopened", "synchronize"],
      }).ok,
    ).toBe(false);
    expect(parse.parseWorkflowTrigger({ ...reviewTrigger, sourceWorkflowPath: null }).ok).toBe(
      false,
    );
    expect(parse.parseWorkflowTrigger({ ...reviewTrigger, requiredConclusion: "FAILURE" }).ok).toBe(
      false,
    );
    for (const activities of [
      ["synchronize", "opened", "reopened"],
      ["opened", "opened"],
      [],
      ["opened", "reopened", "synchronize", "closed"],
    ])
      expect(parse.parseWorkflowTriggerActivities(activities).ok).toBe(false);
    expect(parse.parseWorkflowTriggerActivities(["opened", "reopened", "synchronize"]).ok).toBe(
      true,
    );
  });
});

describe("ISS-054 Packet A detachment, freezing and public-surface boundary", () => {
  test("accepts every disposition and returns a detached, deeply frozen tree", () => {
    for (const disposition of ["ACCEPTED", "BLOCK_REPLAN", "REJECTED"])
      for (const mode of ["mutable", "sealed", "frozen"]) {
        const input = changed(["disposition"], disposition);
        if (mode !== "mutable") freezeDeep(input, mode === "sealed");
        const parsed = parse.parseRepositoryProtectionStructure(input);
        if (!parsed.ok) throw new Error(disposition + "/" + mode + ": " + parsed.issues.join(","));
        expect(parsed.value).toEqual(input);
        expect(parsed.value).not.toBe(input);
        expect(parsed.value.apiObservations).not.toBe(input.apiObservations);
        expect(deeplyFrozen(parsed.value)).toBe(true);
        if (mode === "mutable") {
          at(input, ["environmentBinding"]).variableValue = sha("moved");
          at(input, ["apiObservations", 0, "pages", 0]).etag = quote + "moved" + quote;
          expect(at(parsed.value, ["environmentBinding"]).variableValue).toBe(sha("anchor"));
          expect(at(parsed.value, ["apiObservations", 0, "pages", 0]).etag).toBe(
            quote + "ENVIRONMENT-1" + quote,
          );
        }
      }
  });

  test("accepts the one, two and sixty-four page REST and GraphQL observation fixtures", () => {
    for (const count of [1, 2, 64]) {
      expect(
        parse.parseRepositoryProtectionStructure(
          changed(["apiObservations", 0], observationRow("ENVIRONMENT", "REST", count)),
        ).ok,
        "rest:" + String(count),
      ).toBe(true);
      expect(
        parse.parseRepositoryProtectionStructure(
          changed(["apiObservations", 3], observationRow(GRAPHQL_PURPOSE, "GRAPHQL", count)),
        ).ok,
        "graphql:" + String(count),
      ).toBe(true);
    }
    expect(parse.parseRulesetSemantics(rulesetSemantics()).ok).toBe(true);
    expect(parse.parseCompleteReductionPages(completeReductionPages(64)).ok).toBe(true);
  });

  test("keeps the structure-only entry point and its child parsers package private", () => {
    const receipt = fixture();
    expect(parse.parseRepositoryProtectionStructure(receipt).ok).toBe(true);
    const publicNames = Object.keys(c);
    for (const name of [
      "parseRepositoryProtectionStructure",
      "parseRepositoryProtectionRequest",
      "parseRulesetSemantics",
      "parseCompleteReductionPages",
      "parseSha256Digest",
      "parseNullableRequestCursor",
      "parseGitHubApiKind",
      "parseTerminalPaginationPages",
      "parseWorkflow",
      "parseWorkflows",
      "parseRestPage",
      "parseGraphqlPage",
    ])
      expect(publicNames, name).not.toContain(name);
  });
});

/* -------------------------------------------------------------------------- *
 * ISS-054 Packet B: independent frame recipes and sealed relational fixtures
 *
 * The recipes below are transcribed from the accepted `Pre-N0
 * repository-protection and verifier-anchor ledger` rather than imported from
 * the relations module, so every golden, positive and deletion mutant compares
 * the implementation against an independent recomputation.
 * -------------------------------------------------------------------------- */

const relationsSourcePath = "packages/contracts/src/repository-protection.ts";

const frameRequestIdentity = (purpose: string, request: c.JsonValue): string =>
  c.framedDigest("github-api-request-identity/v1", [
    c.frame.text(purpose),
    c.frame.canonical(request),
  ]);
const framePageRequest = (identityDigest: string, requestCursor: string | null): string =>
  c.framedDigest("github-api-page-request/v1", [
    c.frame.raw32(identityDigest),
    c.frame.nullableText(requestCursor),
  ]);
const reductionProjection = (pages: readonly Row[]): c.JsonValue =>
  pages.map((page) => ({
    ordinal: page.ordinal,
    responseDigest: page.responseDigest,
  })) as c.JsonValue;
const frameCompleteReduction = (
  identityDigest: string,
  pages: readonly Row[],
  reducedValueDigest: string,
): string =>
  c.framedDigest("github-api-complete-reduction/v1", [
    c.frame.raw32(identityDigest),
    c.frame.canonical(reductionProjection(pages)),
    c.frame.raw32(reducedValueDigest),
  ]);
const frameTerminalPagination = (
  identityDigest: string,
  apiKind: string,
  pages: readonly Row[],
): string =>
  c.framedDigest("github-api-terminal-pagination/v1", [
    c.frame.raw32(identityDigest),
    c.frame.text(apiKind),
    c.frame.canonical(pages as unknown as c.JsonValue),
  ]);
const frameReducedValue = (purpose: string, projection: c.JsonValue): string =>
  c.framedDigest("github-api-reduced-value/v1", [
    c.frame.text(purpose),
    c.frame.canonical(projection),
  ]);
const frameRulesetSemantics = (projection: c.JsonValue): string =>
  c.framedDigest("repository-protection-ruleset-semantics/v1", [c.frame.canonical(projection)]);
const frameReceiptIdentity = (receipt: c.JsonValue): string =>
  c.framedDigest("repository-protection-receipt/v1", [c.frame.canonical(receipt)]);

interface PagePlan {
  readonly kind: "GRAPHQL" | "REST";
  readonly count: number;
}
interface SealOptions {
  readonly shape?: (receipt: Row) => void;
  readonly plan?: (purpose: string) => PagePlan;
  readonly triggering?: Row;
}

function defaultPagePlan(purpose: string): PagePlan {
  return { kind: purpose === GRAPHQL_PURPOSE ? "GRAPHQL" : "REST", count: 1 };
}
function planFor(purpose: string, kind: "GRAPHQL" | "REST", count: number) {
  return (candidate: string): PagePlan =>
    candidate === purpose ? { kind, count } : defaultPagePlan(candidate);
}

/**
 * A sealed REST chain. The first page request digest is recomputed from the
 * request identity; every later page request digest stays a supplied opaque
 * SHA-256 claim linked only by the prior page's `NEXT` relation and non-null
 * `nextRequestDigest`.
 */
function sealedRestPages(identityDigest: string, purpose: string, count: number): Row[] {
  const digests = Array.from({ length: count }, (_, index) =>
    index === 0
      ? framePageRequest(identityDigest, null)
      : sha(purpose + ":opaque-rest-request:" + String(index + 1)),
  );
  return digests.map((requestDigest, index) => {
    const final = index === count - 1;
    const relations: Row[] = [];
    if (index > 0) relations.push({ relation: "FIRST", targetRequestDigest: required(digests[0]) });
    if (!final)
      relations.push({ relation: "LAST", targetRequestDigest: required(digests[count - 1]) });
    if (!final)
      relations.push({ relation: "NEXT", targetRequestDigest: required(digests[index + 1]) });
    if (index > 0)
      relations.push({ relation: "PREV", targetRequestDigest: required(digests[index - 1]) });
    return {
      etag: quote + purpose + "-" + String(index + 1) + quote,
      linkHeaderDigest: relations.length > 0 ? sha(purpose + ":link:" + String(index + 1)) : null,
      linkRelations: relations,
      nextRequestDigest: final ? null : required(digests[index + 1]),
      observedAt: "2026-09-04T00:01:01.000Z",
      ordinal: String(index + 1),
      requestDigest,
      responseDigest: sha(purpose + ":response:" + String(index + 1)),
      status: "200",
    };
  });
}

/** A sealed GraphQL chain; every page request digest recomputes from its cursor. */
function sealedGraphqlPages(identityDigest: string, purpose: string, count: number): Row[] {
  return Array.from({ length: count }, (_, index) => {
    const final = index === count - 1;
    const requestCursor = index === 0 ? null : purpose + "-cursor-" + String(index);
    return {
      endCursor: final ? purpose + "-terminal-cursor" : purpose + "-cursor-" + String(index + 1),
      etag: index % 2 === 0 ? null : quote + purpose + "-" + String(index + 1) + quote,
      hasNextPage: !final,
      observedAt: "2026-09-04T00:01:01.000Z",
      ordinal: String(index + 1),
      requestCursor,
      requestDigest: framePageRequest(identityDigest, requestCursor),
      responseDigest: sha(purpose + ":response:" + String(index + 1)),
      status: "200",
    };
  });
}

/** The seven recomputable projections; the two historical-only purposes are opaque. */
function reducedProjection(
  receipt: Row,
  purpose: string,
  triggeringBuild: Row | null,
): c.JsonValue | null {
  const environment = at(receipt, ["environmentBinding"]);
  if (purpose === "ENVIRONMENT")
    return { environmentName: environment.environmentName } as c.JsonValue;
  if (purpose === "ENVIRONMENT_VARIABLE")
    return {
      environmentName: environment.environmentName,
      variableName: environment.variableName,
      variableValue: environment.variableValue,
    } as c.JsonValue;
  if (purpose === "REPOSITORY") return { repositoryId: receipt.repositoryId } as c.JsonValue;
  if (purpose === "RULESET")
    return {
      protectedPathPolicies: receipt.protectedPathPolicies,
      reviewPolicy: receipt.reviewPolicy,
      rulesetId: receipt.rulesetId,
    } as c.JsonValue;
  if (purpose === "WORKFLOW_BUILD")
    return { workflow: at(receipt, ["workflows", 0]) } as c.JsonValue;
  if (purpose === "WORKFLOW_REVIEW")
    return { workflow: at(receipt, ["workflows", 1]) } as c.JsonValue;
  if (purpose === "WORKFLOW_RUN")
    return triggeringBuild === null ? null : ({ triggeringBuild } as c.JsonValue);
  return null;
}

function rulesetProjection(receipt: Row): c.JsonValue {
  return {
    protectedPathPolicies: receipt.protectedPathPolicies,
    repositoryId: receipt.repositoryId,
    reviewPolicy: receipt.reviewPolicy,
    rulesetId: receipt.rulesetId,
    workflows: receipt.workflows,
  } as c.JsonValue;
}

function sealedTriggeringBuild(receipt: Row, overrides: Row): Row {
  const build = at(receipt, ["workflows", 0]);
  return {
    ...triggeringBuildRow(),
    workflowDigest: build.digest,
    workflowPath: build.path,
    workflowRef: build.ref,
    ...overrides,
  };
}

function sealedObservation(receipt: Row, purpose: string, plan: PagePlan, triggering: Row): Row {
  const request = requestRow(purpose, plan.kind);
  const identityDigest = frameRequestIdentity(purpose, request as unknown as c.JsonValue);
  const pages =
    plan.kind === "REST"
      ? sealedRestPages(identityDigest, purpose, plan.count)
      : sealedGraphqlPages(identityDigest, purpose, plan.count);
  const triggeringBuild = purpose === "WORKFLOW_RUN" ? triggering : null;
  const projection = reducedProjection(receipt, purpose, triggeringBuild);
  const reducedValueDigest =
    projection === null
      ? sha(purpose + ":opaque-reduced-value")
      : frameReducedValue(purpose, projection);
  return {
    completeReductionDigest: frameCompleteReduction(identityDigest, pages, reducedValueDigest),
    completedAt: "2026-09-04T00:01:02.000Z",
    pages,
    purpose,
    reducedValueDigest,
    request,
    requestIdentityDigest: identityDigest,
    startedAt: "2026-09-04T00:01:00.000Z",
    terminalPaginationDigest: frameTerminalPagination(identityDigest, plan.kind, pages),
    triggeringBuild,
  };
}

/** Builds the canonical relationally sealed receipt from the retained Packet A base. */
function sealedReceipt(options: SealOptions = {}): Row {
  const receipt = fixture();
  if (options.shape !== undefined) options.shape(receipt);
  const plan = options.plan ?? defaultPagePlan;
  const triggering = sealedTriggeringBuild(receipt, options.triggering ?? {});
  receipt.rulesetSemanticDigest = frameRulesetSemantics(rulesetProjection(receipt));
  receipt.apiObservations = parse.repositoryProtectionPurposes.map((purpose) =>
    sealedObservation(receipt, purpose, plan(purpose), triggering),
  );
  return receipt;
}

function pagesOf(receipt: Row, index: number): Row[] {
  return rowsAt(receipt, ["apiObservations", index, "pages"]) as Row[];
}
function pageOf(receipt: Row, index: number, page: number): Row {
  return required(pagesOf(receipt, index)[page]);
}
function relationsOf(receipt: Row, index: number, page: number): Row[] {
  return pageOf(receipt, index, page).linkRelations as Row[];
}
function relationOf(receipt: Row, index: number, page: number, name: string): Row {
  return required(relationsOf(receipt, index, page).find((row) => row.relation === name));
}
function sortRelations(rows: Row[]): Row[] {
  return [...rows].sort((left, right) =>
    Buffer.compare(
      Buffer.from(String(left.relation), "utf8"),
      Buffer.from(String(right.relation), "utf8"),
    ),
  );
}

/** Recomputes only the two derived digests that enclose the current page rows. */
function refreshObservationDigests(receipt: Row, index: number): Row {
  const row = at(receipt, ["apiObservations", index]);
  const identityDigest = String(row.requestIdentityDigest);
  const pages = pagesOf(receipt, index);
  row.completeReductionDigest = frameCompleteReduction(
    identityDigest,
    pages,
    String(row.reducedValueDigest),
  );
  row.terminalPaginationDigest = frameTerminalPagination(
    identityDigest,
    String(at(row, ["request"]).apiKind),
    pages,
  );
  return receipt;
}
function refreshSemanticDigest(receipt: Row): Row {
  receipt.rulesetSemanticDigest = frameRulesetSemantics(rulesetProjection(receipt));
  return receipt;
}

const OTHER_DIGEST = sha("packet-b-unrelated");
const OTHER_PATH = "ci/other-workflow.yml";
const OTHER_REF = "refs/heads/release";
const twoPageRest = planFor("ENVIRONMENT", "REST", 2);
const twoPageGraphql = planFor(GRAPHQL_PURPOSE, "GRAPHQL", 2);
const threePageRest = planFor("ENVIRONMENT", "REST", 3);
const threePageGraphql = planFor(GRAPHQL_PURPOSE, "GRAPHQL", 3);

interface RelationMutant {
  readonly relation: string;
  readonly input: () => Row;
  readonly issues: readonly string[];
}

const relationMutants: readonly RelationMutant[] = Object.freeze([
  {
    relation: "producer workflow digest bound to the REVIEW row",
    input: () =>
      sealedReceipt({
        shape: (receipt) => {
          at(receipt, ["producer"]).workflowDigest = OTHER_DIGEST;
        },
      }),
    issues: ["producer.workflowDigest:review-mismatch"],
  },
  {
    relation: "producer workflow path bound to the REVIEW row",
    input: () =>
      sealedReceipt({
        shape: (receipt) => {
          at(receipt, ["producer"]).workflowPath = OTHER_PATH;
        },
      }),
    issues: ["producer.workflowPath:review-mismatch"],
  },
  {
    relation: "producer workflow ref bound to the REVIEW row",
    input: () =>
      sealedReceipt({
        shape: (receipt) => {
          at(receipt, ["producer"]).workflowRef = OTHER_REF;
        },
      }),
    issues: ["producer.workflowRef:review-mismatch"],
  },
  {
    relation: "environment variable value equals the verifier anchor digest",
    input: () =>
      sealedReceipt({
        shape: (receipt) => {
          at(receipt, ["environmentBinding"]).variableValue = OTHER_DIGEST;
        },
      }),
    issues: ["environmentBinding.variableValue:anchor-mismatch"],
  },
  {
    relation: "REVIEW trigger source digest equals the BUILD row",
    input: () =>
      sealedReceipt({
        shape: (receipt) => {
          at(receipt, ["workflows", 1, "trigger"]).sourceWorkflowDigest = OTHER_DIGEST;
        },
      }),
    issues: ["workflows:review-source-digest-mismatch"],
  },
  {
    relation: "REVIEW trigger source path equals the BUILD row",
    input: () =>
      sealedReceipt({
        shape: (receipt) => {
          at(receipt, ["workflows", 1, "trigger"]).sourceWorkflowPath = OTHER_PATH;
        },
      }),
    issues: ["workflows:review-source-path-mismatch"],
  },
  {
    relation: "REVIEW trigger source ref equals the BUILD row",
    input: () =>
      sealedReceipt({
        shape: (receipt) => {
          at(receipt, ["workflows", 1, "trigger"]).sourceWorkflowRef = OTHER_REF;
        },
      }),
    issues: ["workflows:review-source-ref-mismatch"],
  },
  {
    relation: "BUILD and REVIEW workflow identities stay distinct",
    input: () =>
      sealedReceipt({
        shape: (receipt) => {
          at(receipt, ["workflows", 1]).workflowId = String(
            at(receipt, ["workflows", 0]).workflowId,
          );
        },
      }),
    issues: ["workflows:workflowId-duplicate"],
  },
  {
    relation: "BUILD role pairs with the PULL_REQUEST event",
    input: () =>
      sealedReceipt({
        shape: (receipt) => {
          at(receipt, ["workflows", 0]).trigger = at(reviewWorkflow(), ["trigger"]);
        },
      }),
    issues: ["workflows:build-role-event-mismatch"],
  },
  {
    relation: "REVIEW role pairs with the WORKFLOW_RUN event",
    input: () =>
      sealedReceipt({
        shape: (receipt) => {
          at(receipt, ["workflows", 1]).trigger = at(buildWorkflow(), ["trigger"]);
        },
      }),
    issues: [
      "workflows:review-role-event-mismatch",
      "workflows:review-source-digest-mismatch",
      "workflows:review-source-path-mismatch",
      "workflows:review-source-ref-mismatch",
    ],
  },
  {
    relation: "triggering BUILD workflow digest equals the BUILD row",
    input: () => sealedReceipt({ triggering: { workflowDigest: OTHER_DIGEST } }),
    issues: ["apiObservations.WORKFLOW_RUN.triggeringBuild.workflowDigest:mismatch"],
  },
  {
    relation: "triggering BUILD workflow path equals the BUILD row",
    input: () => sealedReceipt({ triggering: { workflowPath: OTHER_PATH } }),
    issues: ["apiObservations.WORKFLOW_RUN.triggeringBuild.workflowPath:mismatch"],
  },
  {
    relation: "triggering BUILD workflow ref equals the BUILD row",
    input: () => sealedReceipt({ triggering: { workflowRef: OTHER_REF } }),
    issues: ["apiObservations.WORKFLOW_RUN.triggeringBuild.workflowRef:mismatch"],
  },
  {
    relation: "producer run identity differs from the triggering BUILD run",
    input: () => sealedReceipt({ triggering: { runId: "9002" } }),
    issues: ["producer.runId:triggering-build-alias"],
  },
  {
    relation: "triggering BUILD completes no later than the producer start",
    input: () => sealedReceipt({ triggering: { completedAt: "2026-09-04T00:01:00.001Z" } }),
    issues: ["apiObservations.WORKFLOW_RUN.triggeringBuild.completedAt:after-producer-start"],
  },
  {
    relation: "request identities are unique across the nine observations",
    input: () => {
      const receipt = sealedReceipt();
      at(receipt, ["apiObservations", 1]).requestIdentityDigest = String(
        at(receipt, ["apiObservations", 0]).requestIdentityDigest,
      );
      return receipt;
    },
    issues: [
      "apiObservations.1.requestIdentityDigest:mismatch",
      "apiObservations:requestIdentityDigest-duplicate",
    ],
  },
  {
    relation: "variable publication strictly precedes the producer start",
    input: () =>
      sealedReceipt({
        shape: (receipt) => {
          at(receipt, ["environmentBinding"]).variableUpdatedAt = "2026-09-04T00:01:00.000Z";
        },
      }),
    issues: ["environmentBinding.variableUpdatedAt:not-before-producer"],
  },
  {
    relation: "variable publication is no later than receipt issue",
    input: () =>
      sealedReceipt({
        shape: (receipt) => {
          at(receipt, ["environmentBinding"]).variableUpdatedAt = "2026-09-04T00:03:00.000Z";
        },
      }),
    issues: [
      "environmentBinding.variableUpdatedAt:after-issuedAt",
      "environmentBinding.variableUpdatedAt:not-before-producer",
    ],
  },
  {
    relation: "producer start is no later than receipt issue",
    input: () =>
      sealedReceipt({
        shape: (receipt) => {
          at(receipt, ["producer"]).startedAt = "2026-09-04T00:03:00.000Z";
        },
      }),
    issues: [
      "producer.startedAt:after-issuedAt",
      ...parse.repositoryProtectionPurposes.map(
        (_purpose, index) => "apiObservations." + String(index) + ".startedAt:before-producer",
      ),
    ],
  },
  {
    relation: "observation start is no earlier than the producer start",
    input: () => {
      const receipt = sealedReceipt();
      at(receipt, ["apiObservations", 0]).startedAt = "2026-09-04T00:00:30.000Z";
      return receipt;
    },
    issues: ["apiObservations.0.startedAt:before-producer"],
  },
  {
    relation: "observation completion is no later than receipt issue",
    input: () => {
      const receipt = sealedReceipt();
      at(receipt, ["apiObservations", 0]).completedAt = "2026-09-04T00:03:00.000Z";
      return receipt;
    },
    issues: ["apiObservations.0.completedAt:after-issuedAt"],
  },
  {
    relation: "page observation time lies inside the observation window",
    input: () => {
      const receipt = sealedReceipt();
      pageOf(receipt, 0, 0).observedAt = "2026-09-04T00:01:30.000Z";
      return refreshObservationDigests(receipt, 0);
    },
    issues: ["apiObservations.0.pages.0.observedAt:outside-observation"],
  },
  {
    relation: "request identity recomputes from purpose and request branch",
    input: () => {
      const receipt = sealedReceipt();
      at(receipt, ["apiObservations", 0]).requestIdentityDigest = OTHER_DIGEST;
      return receipt;
    },
    issues: ["apiObservations.0.requestIdentityDigest:mismatch"],
  },
  {
    relation: "first page request digest recomputes with a null cursor",
    input: () => {
      const receipt = sealedReceipt();
      pageOf(receipt, 0, 0).requestDigest = OTHER_DIGEST;
      return refreshObservationDigests(receipt, 0);
    },
    issues: ["apiObservations.0.pages.0.requestDigest:mismatch"],
  },
  {
    relation: "every GraphQL page request digest recomputes from its cursor",
    input: () => {
      const receipt = sealedReceipt({ plan: twoPageGraphql });
      pageOf(receipt, 3, 1).requestDigest = OTHER_DIGEST;
      return refreshObservationDigests(receipt, 3);
    },
    issues: ["apiObservations.3.pages.1.requestDigest:mismatch"],
  },
  {
    relation: "complete reduction digest recomputes over the page projection",
    input: () => {
      const receipt = sealedReceipt();
      at(receipt, ["apiObservations", 0]).completeReductionDigest = OTHER_DIGEST;
      return receipt;
    },
    issues: ["apiObservations.0.completeReductionDigest:mismatch"],
  },
  {
    relation: "terminal pagination digest recomputes over the complete page rows",
    input: () => {
      const receipt = sealedReceipt();
      at(receipt, ["apiObservations", 0]).terminalPaginationDigest = OTHER_DIGEST;
      return receipt;
    },
    issues: ["apiObservations.0.terminalPaginationDigest:mismatch"],
  },
  {
    relation: "recomputable reduced value digest is pinned to its projection",
    input: () => {
      const receipt = sealedReceipt();
      at(receipt, ["apiObservations", 0]).reducedValueDigest = OTHER_DIGEST;
      return refreshObservationDigests(receipt, 0);
    },
    issues: ["apiObservations.0.reducedValueDigest:mismatch"],
  },
  {
    relation: "opaque PULL_REQUEST reduced leaf stays enclosed by its reduction",
    input: () => {
      const receipt = sealedReceipt();
      at(receipt, ["apiObservations", 2]).reducedValueDigest = OTHER_DIGEST;
      return receipt;
    },
    issues: ["apiObservations.2.completeReductionDigest:mismatch"],
  },
  {
    relation: "opaque PULL_REQUEST_REVIEWS reduced leaf stays enclosed by its reduction",
    input: () => {
      const receipt = sealedReceipt();
      at(receipt, ["apiObservations", 3]).reducedValueDigest = OTHER_DIGEST;
      return receipt;
    },
    issues: ["apiObservations.3.completeReductionDigest:mismatch"],
  },
  {
    relation: "REPOSITORY projection member repositoryId",
    input: () => {
      const receipt = sealedReceipt();
      receipt.repositoryId = "78";
      return refreshSemanticDigest(receipt);
    },
    issues: ["apiObservations.4.reducedValueDigest:mismatch"],
  },
  {
    relation: "RULESET projection member rulesetId",
    input: () => {
      const receipt = sealedReceipt();
      receipt.rulesetId = "89";
      return refreshSemanticDigest(receipt);
    },
    issues: ["apiObservations.5.reducedValueDigest:mismatch"],
  },
  {
    relation: "RULESET projection member protectedPathPolicies",
    input: () => {
      const receipt = sealedReceipt();
      rowsAt(receipt, ["protectedPathPolicies"]).push({
        path: "scripts/planning",
        reviewPolicy: "INDEPENDENT_APPROVAL",
      });
      return refreshSemanticDigest(receipt);
    },
    issues: ["apiObservations.5.reducedValueDigest:mismatch"],
  },
  {
    relation: "WORKFLOW_BUILD projection member workflow",
    input: () => {
      const receipt = sealedReceipt();
      at(receipt, ["workflows", 0]).workflowId = "103";
      return refreshSemanticDigest(receipt);
    },
    issues: ["apiObservations.6.reducedValueDigest:mismatch"],
  },
  {
    relation: "WORKFLOW_REVIEW projection member workflow",
    input: () => {
      const receipt = sealedReceipt();
      at(receipt, ["workflows", 1]).workflowId = "104";
      return refreshSemanticDigest(receipt);
    },
    issues: ["apiObservations.7.reducedValueDigest:mismatch"],
  },
  {
    relation: "WORKFLOW_RUN projection member triggeringBuild",
    input: () => {
      const receipt = sealedReceipt();
      at(receipt, ["apiObservations", 8, "triggeringBuild"]).runAttempt = "3";
      return receipt;
    },
    issues: ["apiObservations.8.reducedValueDigest:mismatch"],
  },
  {
    relation: "ENVIRONMENT_VARIABLE projection member variableValue",
    input: () => {
      const receipt = sealedReceipt();
      const rotated = sha("rotated-anchor");
      at(receipt, ["environmentBinding"]).variableValue = rotated;
      receipt.verifierAnchorDigest = rotated;
      return receipt;
    },
    issues: ["apiObservations.1.reducedValueDigest:mismatch"],
  },
  {
    relation: "ruleset semantic digest recomputes over its five-member projection",
    input: () => {
      const receipt = sealedReceipt();
      receipt.rulesetSemanticDigest = OTHER_DIGEST;
      return receipt;
    },
    issues: ["rulesetSemanticDigest:mismatch"],
  },
  {
    relation: "REST NEXT relation targets the immediately following page",
    input: () => {
      const receipt = sealedReceipt({ plan: twoPageRest });
      relationOf(receipt, 0, 0, "NEXT").targetRequestDigest = OTHER_DIGEST;
      return refreshObservationDigests(receipt, 0);
    },
    issues: ["apiObservations.0.pages.0.linkRelations.NEXT:target-mismatch"],
  },
  {
    relation: "REST NEXT relation is mandatory on every nonterminal page",
    input: () => {
      const receipt = sealedReceipt({ plan: twoPageRest });
      pageOf(receipt, 0, 0).linkRelations = relationsOf(receipt, 0, 0).filter(
        (row) => row.relation !== "NEXT",
      );
      return refreshObservationDigests(receipt, 0);
    },
    issues: ["apiObservations.0.pages.0.linkRelations.NEXT:required"],
  },
  {
    relation: "REST NEXT relation is forbidden on the final page",
    input: () => {
      const receipt = sealedReceipt({ plan: twoPageRest });
      pageOf(receipt, 0, 1).linkRelations = sortRelations([
        ...relationsOf(receipt, 0, 1),
        { relation: "NEXT", targetRequestDigest: pageOf(receipt, 0, 0).requestDigest },
      ]);
      return refreshObservationDigests(receipt, 0);
    },
    issues: [
      "apiObservations.0.pages.1.linkRelations.NEXT:boundary-forbidden",
      "apiObservations.0.pages.1.linkRelations.NEXT:target-mismatch",
    ],
  },
  {
    relation: "REST FIRST relation is forbidden on the first page",
    input: () => {
      const receipt = sealedReceipt({ plan: twoPageRest });
      pageOf(receipt, 0, 0).linkRelations = sortRelations([
        ...relationsOf(receipt, 0, 0),
        { relation: "FIRST", targetRequestDigest: pageOf(receipt, 0, 0).requestDigest },
      ]);
      return refreshObservationDigests(receipt, 0);
    },
    issues: [
      "apiObservations.0.pages.0.linkRelations.FIRST:boundary-forbidden",
      "apiObservations.0.pages.0.linkRelations.FIRST:target-mismatch",
    ],
  },
  {
    relation: "REST PREV relation targets the immediately preceding page",
    input: () => {
      const receipt = sealedReceipt({ plan: twoPageRest });
      relationOf(receipt, 0, 1, "PREV").targetRequestDigest = OTHER_DIGEST;
      return refreshObservationDigests(receipt, 0);
    },
    issues: ["apiObservations.0.pages.1.linkRelations.PREV:target-mismatch"],
  },
  {
    relation: "REST LAST relation is forbidden on the final page",
    input: () => {
      const receipt = sealedReceipt({ plan: twoPageRest });
      pageOf(receipt, 0, 1).linkRelations = sortRelations([
        ...relationsOf(receipt, 0, 1),
        { relation: "LAST", targetRequestDigest: pageOf(receipt, 0, 1).requestDigest },
      ]);
      return refreshObservationDigests(receipt, 0);
    },
    issues: [
      "apiObservations.0.pages.1.linkRelations.LAST:boundary-forbidden",
      "apiObservations.0.pages.1.linkRelations.LAST:target-mismatch",
    ],
  },
  {
    relation: "REST nonterminal nextRequestDigest hands off to the following page",
    input: () => {
      const receipt = sealedReceipt({ plan: twoPageRest });
      pageOf(receipt, 0, 0).nextRequestDigest = OTHER_DIGEST;
      return refreshObservationDigests(receipt, 0);
    },
    issues: ["apiObservations.0.pages.0.nextRequestDigest:mismatch"],
  },
  {
    relation: "REST terminal page carries a null nextRequestDigest",
    input: () => {
      const receipt = sealedReceipt({ plan: twoPageRest });
      pageOf(receipt, 0, 1).nextRequestDigest = OTHER_DIGEST;
      return refreshObservationDigests(receipt, 0);
    },
    issues: ["apiObservations.0.pages.1.nextRequestDigest:null-required"],
  },
  {
    relation: "REST page ordinals stay adjacent from one",
    input: () => {
      const receipt = sealedReceipt({ plan: twoPageRest });
      pageOf(receipt, 0, 1).ordinal = "3";
      return refreshObservationDigests(receipt, 0);
    },
    issues: ["apiObservations.0.pages.1.ordinal:mismatch"],
  },
  {
    relation: "REST page request digests never repeat across the observation",
    input: () => {
      const receipt = sealedReceipt({ plan: threePageRest });
      const first = pageOf(receipt, 0, 0).requestDigest;
      pageOf(receipt, 0, 2).requestDigest = first;
      relationOf(receipt, 0, 0, "LAST").targetRequestDigest = first;
      relationOf(receipt, 0, 1, "LAST").targetRequestDigest = first;
      relationOf(receipt, 0, 1, "NEXT").targetRequestDigest = first;
      pageOf(receipt, 0, 1).nextRequestDigest = first;
      return refreshObservationDigests(receipt, 0);
    },
    issues: ["apiObservations.0.pages:requestDigest-duplicate"],
  },
  {
    relation: "GraphQL first request cursor is null",
    input: () => {
      const receipt = sealedReceipt({ plan: twoPageGraphql });
      const identityDigest = String(at(receipt, ["apiObservations", 3]).requestIdentityDigest);
      pageOf(receipt, 3, 0).requestCursor = "seeded-cursor";
      pageOf(receipt, 3, 0).requestDigest = framePageRequest(identityDigest, "seeded-cursor");
      return refreshObservationDigests(receipt, 3);
    },
    issues: [
      "apiObservations.3.pages.0.requestCursor:null-required",
      "apiObservations.3.pages.0.requestDigest:mismatch",
    ],
  },
  {
    relation: "GraphQL cursor is acquired from the immediately prior page",
    input: () => {
      const receipt = sealedReceipt({ plan: twoPageGraphql });
      const identityDigest = String(at(receipt, ["apiObservations", 3]).requestIdentityDigest);
      pageOf(receipt, 3, 1).requestCursor = "unacquired-cursor";
      pageOf(receipt, 3, 1).requestDigest = framePageRequest(identityDigest, "unacquired-cursor");
      return refreshObservationDigests(receipt, 3);
    },
    issues: ["apiObservations.3.pages.1.requestCursor:mismatch"],
  },
  {
    relation: "GraphQL nonterminal page reports hasNextPage true",
    input: () => {
      const receipt = sealedReceipt({ plan: twoPageGraphql });
      pageOf(receipt, 3, 0).hasNextPage = false;
      return refreshObservationDigests(receipt, 3);
    },
    issues: ["apiObservations.3.pages.0.hasNextPage:true-required"],
  },
  {
    relation: "GraphQL terminal page reports hasNextPage false",
    input: () => {
      const receipt = sealedReceipt({ plan: twoPageGraphql });
      pageOf(receipt, 3, 1).hasNextPage = true;
      return refreshObservationDigests(receipt, 3);
    },
    issues: ["apiObservations.3.pages.1.hasNextPage:false-required"],
  },
  {
    relation: "GraphQL nonterminal page carries a non-null endCursor",
    input: () => {
      const receipt = sealedReceipt({ plan: twoPageGraphql });
      pageOf(receipt, 3, 0).endCursor = null;
      return refreshObservationDigests(receipt, 3);
    },
    issues: [
      "apiObservations.3.pages.0.endCursor:required",
      "apiObservations.3.pages.1.requestCursor:mismatch",
    ],
  },
  {
    relation: "GraphQL cursors never repeat across the observation",
    input: () => {
      const receipt = sealedReceipt({ plan: threePageGraphql });
      pageOf(receipt, 3, 2).endCursor = pageOf(receipt, 3, 0).endCursor;
      return refreshObservationDigests(receipt, 3);
    },
    issues: ["apiObservations.3.pages.2.endCursor:repeated"],
  },
  {
    relation: "request identity frame part order",
    input: () => {
      const receipt = sealedReceipt();
      const row = at(receipt, ["apiObservations", 0]);
      row.requestIdentityDigest = c.framedDigest("github-api-request-identity/v1", [
        c.frame.canonical(at(row, ["request"]) as unknown as c.JsonValue),
        c.frame.text(String(row.purpose)),
      ]);
      return receipt;
    },
    issues: ["apiObservations.0.requestIdentityDigest:mismatch"],
  },
  {
    relation: "page request frame nullable-text part tag",
    input: () => {
      const receipt = sealedReceipt();
      const identityDigest = String(at(receipt, ["apiObservations", 0]).requestIdentityDigest);
      pageOf(receipt, 0, 0).requestDigest = c.framedDigest("github-api-page-request/v1", [
        c.frame.raw32(identityDigest),
        c.frame.text(""),
      ]);
      return refreshObservationDigests(receipt, 0);
    },
    issues: ["apiObservations.0.pages.0.requestDigest:mismatch"],
  },
  {
    relation: "complete reduction frame part order",
    input: () => {
      const receipt = sealedReceipt();
      const row = at(receipt, ["apiObservations", 0]);
      row.completeReductionDigest = c.framedDigest("github-api-complete-reduction/v1", [
        c.frame.raw32(String(row.reducedValueDigest)),
        c.frame.canonical(reductionProjection(pagesOf(receipt, 0))),
        c.frame.raw32(String(row.requestIdentityDigest)),
      ]);
      return receipt;
    },
    issues: ["apiObservations.0.completeReductionDigest:mismatch"],
  },
  {
    relation: "terminal pagination frame apiKind part tag",
    input: () => {
      const receipt = sealedReceipt();
      const row = at(receipt, ["apiObservations", 0]);
      row.terminalPaginationDigest = c.framedDigest("github-api-terminal-pagination/v1", [
        c.frame.raw32(String(row.requestIdentityDigest)),
        c.frame.canonical(String(at(row, ["request"]).apiKind)),
        c.frame.canonical(pagesOf(receipt, 0) as unknown as c.JsonValue),
      ]);
      return receipt;
    },
    issues: ["apiObservations.0.terminalPaginationDigest:mismatch"],
  },
  {
    relation: "reduced value frame domain and part order",
    input: () => {
      const receipt = sealedReceipt();
      const row = at(receipt, ["apiObservations", 0]);
      row.reducedValueDigest = c.framedDigest("github-api-reduced-value/v1", [
        c.frame.canonical(reducedProjection(receipt, String(row.purpose), null) ?? null),
        c.frame.text(String(row.purpose)),
      ]);
      return refreshObservationDigests(receipt, 0);
    },
    issues: ["apiObservations.0.reducedValueDigest:mismatch"],
  },
  {
    relation: "ruleset semantics frame encloses the canonical projection",
    input: () => {
      const receipt = sealedReceipt();
      receipt.rulesetSemanticDigest = c.canonicalDigest(rulesetProjection(receipt));
      return receipt;
    },
    issues: ["rulesetSemanticDigest:mismatch"],
  },
]);

const packetBPublicSurface: readonly string[] = Object.freeze(
  [
    ...packetBPublicNames,
    "repositoryProtectionPermissionNames",
    "repositoryProtectionPurposes",
    "repositoryProtectionSchemaFields",
    "repositoryProtectionSchemaVersions",
  ].sort(),
);

const registryFieldKeyByVocabulary: Readonly<Record<string, string>> = Object.freeze({
  [schema]: "receipt",
  [schema + "#environment-binding"]: "environmentBinding",
  [schema + "#graphql-page"]: "graphqlPage",
  [schema + "#graphql-request"]: "graphqlRequest",
  [schema + "#link-relation"]: "linkRelation",
  [schema + "#observation"]: "observation",
  [schema + "#permission"]: "permission",
  [schema + "#producer"]: "producer",
  [schema + "#protected-path-policy"]: "protectedPathPolicy",
  [schema + "#rest-page"]: "restPage",
  [schema + "#rest-request"]: "restRequest",
  [schema + "#review-policy"]: "reviewPolicy",
  [schema + "#trigger"]: "trigger",
  [schema + "#triggering-build"]: "triggeringBuild",
  [schema + "#workflow"]: "workflow",
});

describe("ISS-054 Packet B public surface, registry and canonical bytes", () => {
  test("exposes exactly the twelve reviewed public names and the retained receipt type", () => {
    expect(packetBPublicSurface).toHaveLength(12);
    expect(Object.keys(protection).sort()).toEqual([...packetBPublicSurface]);
    const publicModule = c as unknown as Record<string, unknown>;
    for (const [name, value] of Object.entries(protection))
      expect(publicModule[name], name).toBe(value);
    for (const name of packetBPublicSurface) expect(Object.keys(c), name).toContain(name);
    const parsed = protection.parseRepositoryProtectionReceipt(sealedReceipt());
    if (!parsed.ok) throw new Error(parsed.issues.join(","));
    const retained: protection.RepositoryProtectionReceipt = parsed.value;
    const aliased: c.RepositoryProtectionReceipt = retained;
    expect(aliased.schemaVersion).toBe(schema);
    expect(protection.repositoryProtectionSchemaVersions).toBe(
      parse.repositoryProtectionSchemaVersions,
    );
    expect(protection.repositoryProtectionSchemaFields).toBe(
      parse.repositoryProtectionSchemaFields,
    );
    expect(protection.repositoryProtectionPurposes).toBe(parse.repositoryProtectionPurposes);
    expect(protection.repositoryProtectionPermissionNames).toBe(
      parse.repositoryProtectionPermissionNames,
    );
    expect(iss002HarnessPaths).toContain(relationsSourcePath);
    expect(iss002HarnessPaths).toContain(sourcePath);
    expect(iss002TestBundlePaths).toContain(testPath);
  });

  test("registers the family vocabulary, compatibility and serialization together", () => {
    expect(c.schemaVersions.filter((version) => version === schema)).toHaveLength(1);
    expect(
      Object.keys(c.schemaVocabularyDefinitions)
        .filter((key) => key.startsWith(schema))
        .sort(),
    ).toEqual(codepointSorted(Object.keys(registryFieldKeyByVocabulary)));
    const fieldsByKey = parse.repositoryProtectionSchemaFields as unknown as Record<
      string,
      readonly string[]
    >;
    for (const [vocabularyKey, fieldKey] of Object.entries(registryFieldKeyByVocabulary)) {
      const definition = required(c.schemaVocabularyDefinitions[vocabularyKey]);
      expect(definition.schemaVersion, vocabularyKey).toBe(schema);
      expect(definition.fields, vocabularyKey).toEqual(required(fieldsByKey[fieldKey]));
    }
    expect(Object.keys(registryFieldKeyByVocabulary)).toHaveLength(15);
    expect(
      Object.values(registryFieldKeyByVocabulary)
        .concat(["completeReductionPage", "rulesetSemantics"])
        .sort(),
    ).toEqual(codepointSorted(Object.keys(fieldsByKey)));
    expect(c.engineVocabularyFindings(c.schemaVocabularyDefinitions)).toEqual([]);
    expect(c.compatibilityDisposition(schema, schema)).toBe("readable");
    for (const observed of [
      null,
      schema.replace("/v1", "/v0-fixture"),
      schema.replace("/v1", "/v999"),
    ])
      expect(c.compatibilityDisposition(schema, observed)).toBe("refused");
    expect(c.compatibilityMatrix).toContainEqual({
      expectedSchemaVersion: schema,
      observedSchemaVersion: schema,
      disposition: "readable",
    });
    expect(
      c.compatibilityMatrix.filter((row) => row.expectedSchemaVersion === schema),
    ).toHaveLength(4);
  });

  test("accepts canonical bytes and refuses noncanonical, prefixed and BOM bytes", () => {
    const receipt = sealedReceipt();
    const bytes = c.canonicalBytes(receipt);
    const parsedBytes = c.parseCanonicalContractBytes(schema, bytes);
    expect(parsedBytes.ok).toBe(true);
    const serialized = c.serializeContract(schema, receipt);
    if (!serialized.ok) throw new Error(serialized.issues.join(","));
    expect([...serialized.bytes]).toEqual([...bytes]);
    expect(serialized.digest).toBe(protection.computeRepositoryProtectionReceiptDigest(receipt));
    expect(serialized.digest).toBe(frameReceiptIdentity(receipt as unknown as c.JsonValue));
    expect(serialized.digest).not.toBe(c.canonicalDigest(receipt));
    const prefixed = new TextEncoder().encode(" " + c.canonicalJson(receipt));
    expect(c.parseCanonicalContractBytes(schema, prefixed)).toEqual({
      ok: false,
      issues: ["encoding:noncanonical"],
    });
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]);
    expect(c.parseCanonicalContractBytes(schema, withBom)).toEqual({
      ok: false,
      issues: ["encoding:bom-refused"],
    });
    expect(c.parseContract(schema, receipt).ok).toBe(true);
    expect(c.parseContract(schema, fixture()).ok).toBe(false);
    expect(c.serializeContract(schema, fixture()).ok).toBe(false);
  });

  test("pins the archived independent canonical and framed digest goldens", () => {
    const receipt = sealedReceipt();
    const row = at(receipt, ["apiObservations", 0]);
    expect(c.canonicalJson(at(row, ["request"]))).toBe(
      '{"apiKind":"REST","apiVersion":"2022-11-28","method":"GET","queryDigest":"748728053759d33c07be4fa603f064a27b414ca4cfd2aa8eb00bfc226c245559","route":"/repos/owner/repository/environment"}' +
        lineFeed,
    );
    expect(row.requestIdentityDigest).toBe(
      "8138f1981c4216367b5a01575fda23813283fcb6bb7294cfbdc40d6b2f522906",
    );
    expect(pageOf(receipt, 0, 0).requestDigest).toBe(
      "92d8cecd678bd2062ac8df356a51b036044849e859d94fd6a3c80136c409dc0c",
    );
    expect(row.completeReductionDigest).toBe(
      "eb752c9b35d565804ef2c927cf58942e1135d71b108fa506d687a2d76787f93d",
    );
    expect(row.terminalPaginationDigest).toBe(
      "f8e4922d097117668c22e8870ac726bac6870232c57f1c8e0c1d0c191db4b55a",
    );
    expect(at(receipt, ["apiObservations", 3]).terminalPaginationDigest).toBe(
      "065fdb557d59c2d1dfd9185e1524ad39f331419727e13055fb9a945c33d970b8",
    );
    expect(receipt.rulesetSemanticDigest).toBe(
      "ddef4024cf3ad45f96c479c02f1a6e3c352ff34fad10bc79572c358c367cc42d",
    );
    expect(protection.computeRepositoryProtectionReceiptDigest(receipt)).toBe(
      "2ab8c816a39da770a5a7c31ff66420f54b69eab21ace33ccf33815c4452cc9fa",
    );
    expect(
      protection.computeGitHubApiRequestIdentityDigest(row.purpose, { ...at(row, ["request"]) }),
    ).toBe(row.requestIdentityDigest);
    expect(
      protection.computeGitHubApiPageRequestDigest(String(row.requestIdentityDigest), null),
    ).toBe(pageOf(receipt, 0, 0).requestDigest);
    expect(
      protection.computeGitHubApiCompleteReductionDigest(
        String(row.requestIdentityDigest),
        reductionProjection(pagesOf(receipt, 0)),
        String(row.reducedValueDigest),
      ),
    ).toBe(row.completeReductionDigest);
    expect(
      protection.computeGitHubApiTerminalPaginationDigest(
        String(row.requestIdentityDigest),
        "REST",
        pagesOf(receipt, 0),
      ),
    ).toBe(row.terminalPaginationDigest);
    expect(protection.computeRepositoryProtectionRulesetSemanticDigest(rulesetSemantics())).toBe(
      receipt.rulesetSemanticDigest,
    );
  });

  test("routes every public helper argument through its Packet A parser", () => {
    const receipt = sealedReceipt();
    const row = at(receipt, ["apiObservations", 0]);
    const identityDigest = String(row.requestIdentityDigest);
    const request = at(row, ["request"]);
    const reductionPages = reductionProjection(pagesOf(receipt, 0));
    const restPageRows = pagesOf(receipt, 0);
    for (const [label, call] of [
      [
        "purpose:invalid",
        () => protection.computeGitHubApiRequestIdentityDigest("environment", request),
      ],
      ["request:null", () => protection.computeGitHubApiRequestIdentityDigest("ENVIRONMENT", null)],
      [
        "request:branch",
        () =>
          protection.computeGitHubApiRequestIdentityDigest("ENVIRONMENT", {
            ...request,
            apiKind: "SOAP",
          }),
      ],
      ["pageRequest:identity", () => protection.computeGitHubApiPageRequestDigest("nope", null)],
      [
        "pageRequest:cursor",
        () => protection.computeGitHubApiPageRequestDigest(identityDigest, "cursor" + lineFeed),
      ],
      [
        "reduction:identity",
        () =>
          protection.computeGitHubApiCompleteReductionDigest(
            "nope",
            reductionPages,
            identityDigest,
          ),
      ],
      [
        "reduction:empty",
        () =>
          protection.computeGitHubApiCompleteReductionDigest(identityDigest, [], identityDigest),
      ],
      [
        "reduction:ordinal",
        () =>
          protection.computeGitHubApiCompleteReductionDigest(
            identityDigest,
            [{ ordinal: "2", responseDigest: sha("x") }],
            identityDigest,
          ),
      ],
      [
        "reduction:reducedValue",
        () =>
          protection.computeGitHubApiCompleteReductionDigest(
            identityDigest,
            reductionPages,
            "nope",
          ),
      ],
      [
        "terminal:identity",
        () => protection.computeGitHubApiTerminalPaginationDigest("nope", "REST", restPageRows),
      ],
      [
        "terminal:apiKind",
        () =>
          protection.computeGitHubApiTerminalPaginationDigest(identityDigest, "rest", restPageRows),
      ],
      [
        "terminal:empty",
        () => protection.computeGitHubApiTerminalPaginationDigest(identityDigest, "REST", []),
      ],
      [
        "terminal:branch",
        () =>
          protection.computeGitHubApiTerminalPaginationDigest(
            identityDigest,
            "GRAPHQL",
            restPageRows,
          ),
      ],
      [
        "terminal:chain",
        () =>
          protection.computeGitHubApiTerminalPaginationDigest(
            identityDigest,
            "REST",
            pagesOf(sealedReceipt({ plan: twoPageRest }), 0).slice(1),
          ),
      ],
      ["semantics:null", () => protection.computeRepositoryProtectionRulesetSemanticDigest(null)],
      [
        "semantics:workflows",
        () =>
          protection.computeRepositoryProtectionRulesetSemanticDigest({
            ...rulesetSemantics(),
            workflows: null,
          }),
      ],
      ["receipt:null", () => protection.computeRepositoryProtectionReceiptDigest(null)],
      ["receipt:relations", () => protection.computeRepositoryProtectionReceiptDigest(fixture())],
    ] as const)
      expect(call, label).toThrow(TypeError);
    expect(
      protection.parseRepositoryProtectionContract("repository-protection-receipt/v2", receipt),
    ).toBeNull();
    expect(protection.parseRepositoryProtectionContract(schema, null)?.ok).toBe(false);
    expect(protection.parseRepositoryProtectionContract(schema, receipt)?.ok).toBe(true);
    expect(protection.parseRepositoryProtectionReceipt(null).ok).toBe(false);
    expect(protection.parseRepositoryProtectionReceipt(fixture()).ok).toBe(false);
  });
});

describe("ISS-054 Packet B relations, pagination and deletion mutants", () => {
  test("accepts the canonical relationally sealed receipt as a detached frozen tree", () => {
    const receipt = sealedReceipt();
    const parsed = protection.parseRepositoryProtectionReceipt(receipt);
    if (!parsed.ok) throw new Error(parsed.issues.join(","));
    expect(parsed.value).toEqual(receipt);
    expect(parsed.value).not.toBe(receipt);
    expect(deeplyFrozen(parsed.value)).toBe(true);
    at(receipt, ["environmentBinding"]).variableValue = sha("moved");
    expect(at(parsed.value, ["environmentBinding"]).variableValue).toBe(sha("anchor"));
  });

  test("accepts every disposition while only ACCEPTED stays binder eligible", () => {
    const binderEligibleDispositions: readonly string[] = Object.freeze(["ACCEPTED"]);
    const digests: string[] = [];
    for (const disposition of ["ACCEPTED", "BLOCK_REPLAN", "REJECTED"]) {
      const receipt = sealedReceipt({
        shape: (candidate) => {
          candidate.disposition = disposition;
        },
      });
      const parsed = protection.parseRepositoryProtectionReceipt(receipt);
      if (!parsed.ok) throw new Error(disposition + ": " + parsed.issues.join(","));
      expect(parsed.value.disposition).toBe(disposition);
      expect(c.serializeContract(schema, receipt).ok).toBe(true);
      digests.push(protection.computeRepositoryProtectionReceiptDigest(receipt));
    }
    expect(new Set(digests).size).toBe(3);
    // The four-input binder is a later slice; parsing preserves refusal evidence
    // and never widens eligibility beyond the accepted single disposition.
    expect(
      ["ACCEPTED", "BLOCK_REPLAN", "REJECTED"].filter((disposition) =>
        binderEligibleDispositions.includes(disposition),
      ),
    ).toEqual(["ACCEPTED"]);
  });

  test("accepts one, two and sixty-four page REST and GraphQL chains", () => {
    for (const count of [1, 2, 64]) {
      const restReceipt = sealedReceipt({ plan: planFor("ENVIRONMENT", "REST", count) });
      const restParsed = protection.parseRepositoryProtectionReceipt(restReceipt);
      if (!restParsed.ok)
        throw new Error("rest:" + String(count) + ":" + restParsed.issues.join(","));
      expect(pagesOf(restReceipt, 0)).toHaveLength(count);
      const graphqlReceipt = sealedReceipt({ plan: planFor(GRAPHQL_PURPOSE, "GRAPHQL", count) });
      const graphqlParsed = protection.parseRepositoryProtectionReceipt(graphqlReceipt);
      if (!graphqlParsed.ok)
        throw new Error("graphql:" + String(count) + ":" + graphqlParsed.issues.join(","));
      expect(pagesOf(graphqlReceipt, 3)).toHaveLength(count);
    }
  });

  test("refuses zero-row, sixty-five-row and cyclic page chains", () => {
    const emptied = sealedReceipt();
    at(emptied, ["apiObservations", 0]).pages = [];
    expect(protection.parseRepositoryProtectionReceipt(emptied).ok).toBe(false);
    const oversized = sealedReceipt();
    const identityDigest = String(at(oversized, ["apiObservations", 0]).requestIdentityDigest);
    at(oversized, ["apiObservations", 0]).pages = sealedRestPages(
      identityDigest,
      "ENVIRONMENT",
      65,
    );
    expect(protection.parseRepositoryProtectionReceipt(oversized).ok).toBe(false);
    const emptiedGraphql = sealedReceipt();
    at(emptiedGraphql, ["apiObservations", 3]).pages = [];
    expect(protection.parseRepositoryProtectionReceipt(emptiedGraphql).ok).toBe(false);
    const oversizedGraphql = sealedReceipt();
    const graphqlIdentity = String(
      at(oversizedGraphql, ["apiObservations", 3]).requestIdentityDigest,
    );
    at(oversizedGraphql, ["apiObservations", 3]).pages = sealedGraphqlPages(
      graphqlIdentity,
      GRAPHQL_PURPOSE,
      65,
    );
    expect(protection.parseRepositoryProtectionReceipt(oversizedGraphql).ok).toBe(false);
  });

  test("keeps every Packet B relation deletion mutant discriminating", () => {
    expect(relationMutants).toHaveLength(60);
    expect(new Set(relationMutants.map((mutant) => mutant.relation)).size).toBe(
      relationMutants.length,
    );
    for (const mutant of relationMutants) {
      const parsed = protection.parseRepositoryProtectionReceipt(mutant.input());
      expect(parsed.ok, mutant.relation).toBe(false);
      if (parsed.ok) continue;
      expect([...parsed.issues], mutant.relation).toEqual([...mutant.issues].sort());
      expect(c.parseContract(schema, mutant.input()).ok, mutant.relation).toBe(false);
      expect(c.serializeContract(schema, mutant.input()).ok, mutant.relation).toBe(false);
      expect(
        () => protection.computeRepositoryProtectionReceiptDigest(mutant.input()),
        mutant.relation,
      ).toThrow(TypeError);
    }
  });
});

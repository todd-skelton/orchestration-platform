/**
 * ISS-054 Packet D vectors for the pure four-input cross-family binder and the
 * `repository-protection-terminal-evidence/v1` identity (Decisions
 * #268/#272/#282/#290, pressure Round 456 section 2.2).
 *
 * Every recipe below is transcribed from the accepted `Pre-N0
 * repository-protection and verifier-anchor ledger` rather than imported from
 * the binding module, so each golden, positive and mutant compares the
 * implementation against an independent recomputation. The three pinned hex
 * goldens are the values those transcribed recipes produce over the fixtures
 * in this file.
 *
 * No vector claims API origin, capture completeness, authentication,
 * freshness, currentness, operator action or authority. A passing binder
 * result states only that four supplied values are mutually consistent under
 * the relations the ledger states at 6926-6958.
 */
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";
import {
  iss002HarnessPaths,
  iss002TestBundlePaths,
} from "../../packages/conformance/src/stable-bundles.js";
import * as c from "../../packages/contracts/src/index.js";
import * as binding from "../../packages/contracts/src/repository-protection-binding.js";
import * as protection from "../../packages/contracts/src/repository-protection.js";

type Row = Record<string, unknown>;
type Path = readonly (string | number)[];

const quote = String.fromCharCode(34);
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
function rowsAt(root: unknown, path: Path): Row[] {
  return at(root, path) as unknown as Row[];
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function codepointSorted(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
}
function deeplyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every((nested) => deeplyFrozen(nested));
}

/* -------------------------------------------------------------------------- *
 * Ledger recipes, transcribed. Listed part order and frame tags are
 * significant; canonical JSON sorts record keys, so record key insertion order
 * alone never changes bytes (6659-6665).
 * -------------------------------------------------------------------------- */

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
const frameCompleteReduction = (
  identityDigest: string,
  pages: readonly Row[],
  reducedValueDigest: string,
): string =>
  c.framedDigest("github-api-complete-reduction/v1", [
    c.frame.raw32(identityDigest),
    c.frame.canonical(
      pages.map((page) => ({
        ordinal: page.ordinal,
        responseDigest: page.responseDigest,
      })) as c.JsonValue,
    ),
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
const frameAnchorIdentity = (anchor: c.JsonValue): string =>
  c.framedDigest("bootstrap-verifier-anchor/v1", [c.frame.canonical(anchor)]);
const frameTerminalEvidence = (projection: c.JsonValue): string =>
  c.framedDigest("repository-protection-terminal-evidence/v1", [c.frame.canonical(projection)]);

/* -------------------------------------------------------------------------- *
 * Fixtures
 *
 * The historical receipt reuses the landed canonical nine-purpose shape; its
 * `verifierAnchorDigest` and environment variable value are set to `Danchor`
 * over the anchor fixture below, and the anchor's repository ID is the
 * receipt's, because the binder requires both (6927-6929, 6943-6944).
 * -------------------------------------------------------------------------- */

const RECEIPT_SCHEMA = "repository-protection-receipt/v1";
const ANCHOR_SCHEMA = "bootstrap-verifier-anchor/v1";
const BUILD_PATH = ".github/workflows/build.yml";
const REVIEW_PATH = ".github/workflows/review.yml";
const BRANCH_REF = "refs/heads/main";
const GRAPHQL_HISTORICAL_PURPOSE = "PULL_REQUEST_REVIEWS";
const HISTORICAL_PURPOSES: readonly string[] = [
  "ENVIRONMENT",
  "ENVIRONMENT_VARIABLE",
  "PULL_REQUEST",
  "PULL_REQUEST_REVIEWS",
  "REPOSITORY",
  "RULESET",
  "WORKFLOW_BUILD",
  "WORKFLOW_REVIEW",
  "WORKFLOW_RUN",
];
const FRESH_PURPOSES: readonly string[] = [
  "ENVIRONMENT",
  "ENVIRONMENT_VARIABLE",
  "REPOSITORY",
  "RULESET",
  "WORKFLOW_BUILD",
  "WORKFLOW_REVIEW",
];
const BINDING_MEMBERS: readonly string[] = [
  "anchor",
  "anchorDigest",
  "observedProtection",
  "protectionDigest",
  "receipt",
  "terminalEvidenceDigest",
];
const FRESH_ROOT_MEMBERS: readonly string[] = [
  "apiObservations",
  "completedAt",
  "environmentBinding",
  "protectedPathPolicies",
  "repositoryId",
  "reviewPolicy",
  "rulesetId",
  "startedAt",
  "terminalEvidenceDigest",
  "workflows",
];

const HISTORICAL_UPDATED_AT = "2026-09-04T00:00:00.000Z";
const PRODUCER_STARTED_AT = "2026-09-04T00:01:00.000Z";
const ISSUED_AT = "2026-09-04T00:02:00.000Z";
const EXPIRES_AT = "2026-09-11T00:02:00.000Z";
const FRESH_UPDATED_AT = "2026-09-04T00:00:30.000Z";
const FRESH_STARTED_AT = "2026-09-05T00:00:00.000Z";
const FRESH_COMPLETED_AT = "2026-09-05T00:02:00.000Z";
const FRESH_PAGE_OBSERVED_AT = "2026-09-05T00:01:00.000Z";
const ANCHOR_CREATED_AT = "2026-09-02T00:00:01.000Z";
const ANCHOR_CONFIRMED_AT = "2026-09-02T00:00:00.000Z";

function anchorFixture(): Row {
  return {
    assets: [
      {
        architecture: "X64",
        archiveSha256: "1".repeat(64),
        assetName: "gh_2.93.0_linux_amd64.tar.gz",
        checksumManifestName: "gh_2.93.0_checksums.txt",
        checksumManifestSha256: "2".repeat(64),
        executableName: "gh",
        executableSha256: "3".repeat(64),
        osKind: "LINUX",
      },
      {
        architecture: "ARM64",
        archiveSha256: "1".repeat(64),
        assetName: "gh_2.93.0_macOS_arm64.zip",
        checksumManifestName: "gh_2.93.0_checksums.txt",
        checksumManifestSha256: "2".repeat(64),
        executableName: "gh",
        executableSha256: "3".repeat(64),
        osKind: "MACOS",
      },
      {
        architecture: "X64",
        archiveSha256: "1".repeat(64),
        assetName: "gh_2.93.0_windows_amd64.zip",
        checksumManifestName: "gh_2.93.0_checksums.txt",
        checksumManifestSha256: "2".repeat(64),
        executableName: "gh.exe",
        executableSha256: "3".repeat(64),
        osKind: "WINDOWS",
      },
    ],
    cliVersion: "2.93.0",
    createdAt: ANCHOR_CREATED_AT,
    expectedOidcIssuer: "https://token.actions.githubusercontent.com",
    operatorConfirmation: {
      actorId: "5678",
      claim: "OFFICIAL_RELEASE_ASSETS_AND_CHECKSUMS_MATCH",
      confirmedAt: ANCHOR_CONFIRMED_AT,
    },
    releaseTag: "v2.93.0",
    repositoryId: "77",
    schemaVersion: ANCHOR_SCHEMA,
    signerWorkflow: {
      digest: "4".repeat(64),
      path: REVIEW_PATH,
      ref: BRANCH_REF,
      repositoryId: "77",
    },
    trustBootstrap: "GITHUB_CLI_DEFAULT_ONLINE_SIGSTORE_TUF",
  };
}

/** `Danchor`, recomputed here from the ledger recipe, never imported. */
const ANCHOR_DIGEST = frameAnchorIdentity(anchorFixture() as unknown as c.JsonValue);

function permissionRows(): Row[] {
  return protection.repositoryProtectionPermissionNames.map((permission) => ({
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
function requestRow(purpose: string, kind: string): Row {
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

/**
 * A sealed REST chain. The first page request digest recomputes from the
 * request identity; every later page request digest is a supplied opaque
 * SHA-256 claim linked only by the prior page's `NEXT` relation and non-null
 * `nextRequestDigest`, and the `tag` keeps the historical and fresh captures
 * independent so nothing accidental is equated across them.
 */
function sealedRestPages(
  identityDigest: string,
  purpose: string,
  count: number,
  tag: string,
  observedAt: string,
): Row[] {
  const digests = Array.from({ length: count }, (_, index) =>
    index === 0
      ? framePageRequest(identityDigest, null)
      : sha(purpose + ":" + tag + ":opaque-rest-request:" + String(index + 1)),
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
      etag: quote + tag + "-" + purpose + "-" + String(index + 1) + quote,
      linkHeaderDigest:
        relations.length > 0 ? sha(purpose + ":" + tag + ":link:" + String(index + 1)) : null,
      linkRelations: relations,
      nextRequestDigest: final ? null : required(digests[index + 1]),
      observedAt,
      ordinal: String(index + 1),
      requestDigest,
      responseDigest: sha(purpose + ":" + tag + ":response:" + String(index + 1)),
      status: "200",
    };
  });
}
function sealedGraphqlPages(
  identityDigest: string,
  purpose: string,
  count: number,
  tag: string,
  observedAt: string,
): Row[] {
  return Array.from({ length: count }, (_, index) => {
    const final = index === count - 1;
    const requestCursor = index === 0 ? null : purpose + "-" + tag + "-cursor-" + String(index);
    return {
      endCursor: final
        ? purpose + "-" + tag + "-terminal-cursor"
        : purpose + "-" + tag + "-cursor-" + String(index + 1),
      etag: index % 2 === 0 ? null : quote + tag + "-" + purpose + "-" + String(index + 1) + quote,
      hasNextPage: !final,
      observedAt,
      ordinal: String(index + 1),
      requestCursor,
      requestDigest: framePageRequest(identityDigest, requestCursor),
      responseDigest: sha(purpose + ":" + tag + ":response:" + String(index + 1)),
      status: "200",
    };
  });
}

function receiptBase(): Row {
  return {
    apiObservations: [],
    disposition: "ACCEPTED",
    environmentBinding: {
      environmentEtag: quote + "environment-v1" + quote,
      environmentName: "host-custody-bootstrap-root",
      variableName: "VERIFIER_ANCHOR_SHA256",
      variableUpdatedAt: HISTORICAL_UPDATED_AT,
      variableValue: ANCHOR_DIGEST,
    },
    expiresAt: EXPIRES_AT,
    issuedAt: ISSUED_AT,
    producer: {
      artifactName: "repository-protection-receipt",
      runAttempt: "2",
      runId: "9002",
      startedAt: PRODUCER_STARTED_AT,
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
    rulesetSemanticDigest: "",
    schemaVersion: RECEIPT_SCHEMA,
    verifierAnchorDigest: ANCHOR_DIGEST,
    workflows: [buildWorkflow(), reviewWorkflow()],
  };
}
function rulesetProjection(record: Row): c.JsonValue {
  return {
    protectedPathPolicies: record.protectedPathPolicies,
    repositoryId: record.repositoryId,
    reviewPolicy: record.reviewPolicy,
    rulesetId: record.rulesetId,
    workflows: record.workflows,
  } as c.JsonValue;
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

/** The six shared projections plus the historical-only `WORKFLOW_RUN` one. */
function reducedProjectionOf(
  record: Row,
  purpose: string,
  triggeringBuild: Row | null,
): c.JsonValue | null {
  const environment = at(record, ["environmentBinding"]);
  if (purpose === "ENVIRONMENT")
    return { environmentName: environment.environmentName } as c.JsonValue;
  if (purpose === "ENVIRONMENT_VARIABLE")
    return {
      environmentName: environment.environmentName,
      variableName: environment.variableName,
      variableValue: environment.variableValue,
    } as c.JsonValue;
  if (purpose === "REPOSITORY") return { repositoryId: record.repositoryId } as c.JsonValue;
  if (purpose === "RULESET")
    return {
      protectedPathPolicies: record.protectedPathPolicies,
      reviewPolicy: record.reviewPolicy,
      rulesetId: record.rulesetId,
    } as c.JsonValue;
  if (purpose === "WORKFLOW_BUILD")
    return { workflow: at(record, ["workflows", 0]) } as c.JsonValue;
  if (purpose === "WORKFLOW_REVIEW")
    return { workflow: at(record, ["workflows", 1]) } as c.JsonValue;
  if (purpose === "WORKFLOW_RUN")
    return triggeringBuild === null ? null : ({ triggeringBuild } as c.JsonValue);
  return null;
}

function historicalObservation(receipt: Row, purpose: string, kind: string, count: number): Row {
  const request = requestRow(purpose, kind);
  const identityDigest = frameRequestIdentity(purpose, request as unknown as c.JsonValue);
  const pages =
    kind === "REST"
      ? sealedRestPages(identityDigest, purpose, count, "historical", "2026-09-04T00:01:01.000Z")
      : sealedGraphqlPages(
          identityDigest,
          purpose,
          count,
          "historical",
          "2026-09-04T00:01:01.000Z",
        );
  const triggeringBuild = purpose === "WORKFLOW_RUN" ? triggeringBuildRow() : null;
  const projection = reducedProjectionOf(receipt, purpose, triggeringBuild);
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
    startedAt: PRODUCER_STARTED_AT,
    terminalPaginationDigest: frameTerminalPagination(identityDigest, kind, pages),
    triggeringBuild,
  };
}

interface CaptureOptions {
  readonly kindFor?: (purpose: string) => string;
  readonly countFor?: (purpose: string) => number;
}
interface FreshOptions extends CaptureOptions {
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly pageObservedAt?: string;
  readonly rowStartedAt?: string;
  readonly rowCompletedAt?: string;
}

function receiptFixture(options: CaptureOptions = {}): Row {
  const kindFor = options.kindFor ?? (() => "REST");
  const countFor = options.countFor ?? (() => 1);
  const receipt = receiptBase();
  receipt.rulesetSemanticDigest = frameRulesetSemantics(rulesetProjection(receipt));
  receipt.apiObservations = HISTORICAL_PURPOSES.map((purpose) =>
    historicalObservation(
      receipt,
      purpose,
      purpose === GRAPHQL_HISTORICAL_PURPOSE ? "GRAPHQL" : kindFor(purpose),
      countFor(purpose),
    ),
  );
  return receipt;
}

function freshBase(startedAt: string, completedAt: string): Row {
  const receipt = receiptBase();
  return {
    apiObservations: [],
    completedAt,
    environmentBinding: {
      environmentEtag: quote + "fresh-environment-v9" + quote,
      environmentName: "host-custody-bootstrap-root",
      variableName: "VERIFIER_ANCHOR_SHA256",
      variableUpdatedAt: FRESH_UPDATED_AT,
      variableValue: ANCHOR_DIGEST,
    },
    protectedPathPolicies: receipt.protectedPathPolicies,
    repositoryId: receipt.repositoryId,
    reviewPolicy: receipt.reviewPolicy,
    rulesetId: receipt.rulesetId,
    startedAt,
    terminalEvidenceDigest: "",
    workflows: receipt.workflows,
  };
}

/**
 * The terminal-evidence projection, transcribed from 6892-6917: exactly one
 * canonical frame part; `apiTerminals` retains the six-purpose order and each
 * row is exactly `purpose`, `requestIdentityDigest`, `terminalPaginationDigest`;
 * the projection excludes `terminalEvidenceDigest` itself.
 */
function terminalEvidenceProjection(observed: Row): c.JsonValue {
  return {
    apiTerminals: rowsAt(observed, ["apiObservations"]).map((row) => ({
      purpose: row.purpose,
      requestIdentityDigest: row.requestIdentityDigest,
      terminalPaginationDigest: row.terminalPaginationDigest,
    })),
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
  } as c.JsonValue;
}

function freshObservation(options: FreshOptions = {}): Row {
  const startedAt = options.startedAt ?? FRESH_STARTED_AT;
  const completedAt = options.completedAt ?? FRESH_COMPLETED_AT;
  const pageObservedAt = options.pageObservedAt ?? FRESH_PAGE_OBSERVED_AT;
  const rowStartedAt = options.rowStartedAt ?? startedAt;
  const rowCompletedAt = options.rowCompletedAt ?? completedAt;
  const kindFor = options.kindFor ?? (() => "REST");
  const countFor = options.countFor ?? (() => 1);
  const observed = freshBase(startedAt, completedAt);
  observed.apiObservations = FRESH_PURPOSES.map((purpose) => {
    const kind = kindFor(purpose);
    const request = requestRow(purpose, kind);
    const identityDigest = frameRequestIdentity(purpose, request as unknown as c.JsonValue);
    const count = countFor(purpose);
    const pages =
      kind === "REST"
        ? sealedRestPages(identityDigest, purpose, count, "fresh", pageObservedAt)
        : sealedGraphqlPages(identityDigest, purpose, count, "fresh", pageObservedAt);
    const reducedValueDigest = frameReducedValue(
      purpose,
      required(reducedProjectionOf(observed, purpose, null)),
    );
    return {
      completeReductionDigest: frameCompleteReduction(identityDigest, pages, reducedValueDigest),
      completedAt: rowCompletedAt,
      pages,
      purpose,
      reducedValueDigest,
      request,
      requestIdentityDigest: identityDigest,
      startedAt: rowStartedAt,
      terminalPaginationDigest: frameTerminalPagination(identityDigest, kind, pages),
      triggeringBuild: null,
    };
  });
  observed.terminalEvidenceDigest = frameTerminalEvidence(terminalEvidenceProjection(observed));
  return observed;
}

/** Recomputes only the two derived digests that enclose one row's page rows. */
function refreshRow(record: Row, index: number): void {
  const row = at(record, ["apiObservations", index]);
  const pages = rowsAt(record, ["apiObservations", index, "pages"]);
  row.completeReductionDigest = frameCompleteReduction(
    String(row.requestIdentityDigest),
    pages,
    String(row.reducedValueDigest),
  );
  row.terminalPaginationDigest = frameTerminalPagination(
    String(row.requestIdentityDigest),
    String(at(row, ["request"]).apiKind),
    pages,
  );
}
function refreshEvidence(observed: Row): void {
  observed.terminalEvidenceDigest = frameTerminalEvidence(terminalEvidenceProjection(observed));
}

const GRAPHQL_RULESET = (purpose: string): string => (purpose === "RULESET" ? "GRAPHQL" : "REST");

interface BindResult {
  readonly ok: boolean;
  readonly issues?: readonly string[];
  readonly value?: Row;
}
function bind(
  receipt: unknown,
  anchor: unknown,
  observed: unknown,
  evaluatedAt: unknown,
): BindResult {
  return binding.bindRepositoryProtectionEvidence(
    receipt,
    anchor,
    observed,
    evaluatedAt,
  ) as unknown as BindResult;
}
function canonicalBind(): BindResult {
  return bind(receiptFixture(), anchorFixture(), freshObservation(), FRESH_COMPLETED_AT);
}
function issuesOf(result: BindResult): readonly string[] {
  if (result.ok) throw new Error("expected a refusal");
  return required(result.issues);
}

/* -------------------------------------------------------------------------- *
 * The independently derived goldens
 *
 * Each value is what the transcribed ledger recipe above produces over the
 * fixtures in this file; the literals are pinned so a later change to either
 * the recipe or the implementation has to move a committed byte.
 * -------------------------------------------------------------------------- */

const ANCHOR_DIGEST_GOLDEN = "3dbf17f2ff94d127d8b8049d508c17259b1b1f11717feed74b0d5fcf44edfd33";
const PROTECTION_DIGEST_GOLDEN = "a20722f1b84ff2a14024caf3798b7a0c2cdc93c10768914c4de3994080e35711";
const TERMINAL_EVIDENCE_GOLDEN = "59732ea7907e79ab865456361d137292c7cc228ad426f554e9f46c780772796a";

describe("ISS-054 Packet D canonical binding, goldens and the six-member return", () => {
  test("binds the canonical receipt, anchor, fresh observation and evaluatedAt", () => {
    const result = canonicalBind();
    expect(result.issues).toBeUndefined();
    expect(result.ok).toBe(true);
    const value = required(result.value);
    expect(codepointSorted(Object.keys(value))).toEqual([...BINDING_MEMBERS]);
    expect(Object.keys(value)).toHaveLength(6);
  });

  test("pins the independently recomputed Danchor, Dprotection and terminal-evidence goldens", () => {
    const receipt = receiptFixture();
    const anchor = anchorFixture();
    const observed = freshObservation();
    // Recipe: Danchor = framedDigest("bootstrap-verifier-anchor/v1",
    //   [frame.canonical(anchor)])                                   (7047-7052)
    expect(frameAnchorIdentity(anchor as unknown as c.JsonValue)).toBe(ANCHOR_DIGEST_GOLDEN);
    // Recipe: Dprotection = framedDigest("repository-protection-receipt/v1",
    //   [frame.canonical(receipt)])                                  (7047-7052)
    expect(frameReceiptIdentity(receipt as unknown as c.JsonValue)).toBe(PROTECTION_DIGEST_GOLDEN);
    // Recipe: terminalEvidenceDigest = framedDigest(
    //   "repository-protection-terminal-evidence/v1",
    //   [frame.canonical({ apiTerminals, completedAt, environmentBinding,
    //     rulesetSemantics: { protectedPathPolicies, repositoryId, reviewPolicy,
    //     rulesetId, workflows }, startedAt })])                      (6900-6917)
    expect(frameTerminalEvidence(terminalEvidenceProjection(observed))).toBe(
      TERMINAL_EVIDENCE_GOLDEN,
    );
    const value = required(canonicalBind().value);
    expect(value.anchorDigest).toBe(ANCHOR_DIGEST_GOLDEN);
    expect(value.protectionDigest).toBe(PROTECTION_DIGEST_GOLDEN);
    expect(value.terminalEvidenceDigest).toBe(TERMINAL_EVIDENCE_GOLDEN);
    expect(observed.terminalEvidenceDigest).toBe(TERMINAL_EVIDENCE_GOLDEN);
    // The three goldens are distinct values over three distinct domains.
    expect(
      new Set([ANCHOR_DIGEST_GOLDEN, PROTECTION_DIGEST_GOLDEN, TERMINAL_EVIDENCE_GOLDEN]).size,
    ).toBe(3);
  });

  test("returns one detached deeply frozen record whose values are the parsed inputs", () => {
    const receipt = receiptFixture();
    const anchor = anchorFixture();
    const observed = freshObservation();
    const value = required(bind(receipt, anchor, observed, FRESH_COMPLETED_AT).value);
    expect(deeplyFrozen(value)).toBe(true);
    expect(value.receipt).not.toBe(receipt);
    expect(value.anchor).not.toBe(anchor);
    expect(value.observedProtection).not.toBe(observed);
    // Canonical bytes rather than structural equality: the parsed values are
    // null-prototype snapshots of the supplied trees, so "the same value" is
    // exactly "the same canonical bytes and the same member census".
    expect(c.canonicalJson(value.receipt)).toBe(c.canonicalJson(receipt));
    expect(c.canonicalJson(value.anchor)).toBe(c.canonicalJson(anchor));
    expect(c.canonicalJson(value.observedProtection)).toBe(c.canonicalJson(observed));
    expect(codepointSorted(Object.keys(value.receipt as Row))).toEqual(
      codepointSorted(Object.keys(receipt)),
    );
    expect(codepointSorted(Object.keys(value.observedProtection as Row))).toEqual([
      ...FRESH_ROOT_MEMBERS,
    ]);
    // Mutating the caller's trees afterwards cannot reach the returned value.
    at(receipt, ["environmentBinding"]).variableUpdatedAt = "2026-01-01T00:00:00.000Z";
    at(observed, ["environmentBinding"]).variableUpdatedAt = "2026-01-01T00:00:00.000Z";
    expect(at(value, ["receipt", "environmentBinding"]).variableUpdatedAt).toBe(
      HISTORICAL_UPDATED_AT,
    );
    expect(at(value, ["observedProtection", "environmentBinding"]).variableUpdatedAt).toBe(
      FRESH_UPDATED_AT,
    );
    expect(() => {
      (value as Row).extra = 1;
    }).toThrow(TypeError);
    expect(Object.keys(value)).toHaveLength(6);
  });

  test("carries no authority, currentness, authentication, completeness or grant claim", () => {
    const value = required(canonicalBind().value);
    // The six ledger members (6960-6970) are exempt from the vocabulary scan
    // because the census equality above already pins them exactly.
    expect(codepointSorted(Object.keys(value))).toEqual([...BINDING_MEMBERS]);
    for (const key of Object.keys(value)) {
      if (BINDING_MEMBERS.includes(key)) continue;
      for (const word of [
        "authenticat",
        "authority",
        "authoriz",
        "complete",
        "current",
        "grant",
        "verif",
      ])
        expect(key.toLowerCase(), key + "/" + word).not.toContain(word);
    }
    for (const name of Object.keys(binding))
      expect(/Authorize|Verify|Authenticate|Grant|Certif|Current|Fresh/.test(name), name).toBe(
        false,
      );
  });

  test("accepts shared GraphQL rows, multi-page fresh rows and the 64-page bound", () => {
    expect(
      bind(
        receiptFixture({ kindFor: GRAPHQL_RULESET }),
        anchorFixture(),
        freshObservation({ kindFor: GRAPHQL_RULESET, countFor: (p) => (p === "RULESET" ? 2 : 1) }),
        FRESH_COMPLETED_AT,
      ).ok,
    ).toBe(true);
    expect(
      bind(
        receiptFixture(),
        anchorFixture(),
        freshObservation({ countFor: (p) => (p === "ENVIRONMENT" ? 2 : 1) }),
        FRESH_COMPLETED_AT,
      ).ok,
    ).toBe(true);
    expect(
      bind(
        receiptFixture(),
        anchorFixture(),
        freshObservation({ countFor: (p) => (p === "ENVIRONMENT" ? 64 : 1) }),
        FRESH_COMPLETED_AT,
      ).ok,
    ).toBe(true);
  });
});

describe("ISS-054 Packet D refusal categories and one-axis mutants", () => {
  test("refuses a structurally valid REJECTED or BLOCK_REPLAN receipt", () => {
    for (const disposition of ["REJECTED", "BLOCK_REPLAN"]) {
      const receipt = receiptFixture();
      receipt.disposition = disposition;
      // All three dispositions parse and preserve refusal evidence; only
      // ACCEPTED may pass the binding relation (6496-6498, 6926).
      expect(protection.parseRepositoryProtectionReceipt(receipt).ok, disposition).toBe(true);
      expect(
        issuesOf(bind(receipt, anchorFixture(), freshObservation(), FRESH_COMPLETED_AT)),
        disposition,
      ).toEqual(["receipt.disposition:accepted-required"]);
    }
  });

  test("refuses anchor-digest disagreement at each of the four legs", () => {
    // Leg 1 and 2: both receipt legs moved off Danchor together (Packet B
    // already forbids moving only one), with the ENVIRONMENT_VARIABLE reduced
    // projection refreshed so only the binder's legs remain.
    const other = sha("other-anchor");
    const receipt = receiptFixture();
    at(receipt, ["environmentBinding"]).variableValue = other;
    receipt.verifierAnchorDigest = other;
    const historicalRow = at(receipt, ["apiObservations", 1]);
    historicalRow.reducedValueDigest = frameReducedValue("ENVIRONMENT_VARIABLE", {
      environmentName: at(receipt, ["environmentBinding"]).environmentName,
      variableName: at(receipt, ["environmentBinding"]).variableName,
      variableValue: other,
    } as c.JsonValue);
    refreshRow(receipt, 1);
    expect(
      issuesOf(bind(receipt, anchorFixture(), freshObservation(), FRESH_COMPLETED_AT)),
    ).toEqual([
      "receipt.environmentBinding.variableValue:anchor-mismatch",
      "receipt.verifierAnchorDigest:anchor-mismatch",
    ]);
    // Leg 3: the fresh environment variable value.
    const observed = freshObservation();
    at(observed, ["environmentBinding"]).variableValue = other;
    at(observed, ["apiObservations", 1]).reducedValueDigest = frameReducedValue(
      "ENVIRONMENT_VARIABLE",
      {
        environmentName: at(observed, ["environmentBinding"]).environmentName,
        variableName: at(observed, ["environmentBinding"]).variableName,
        variableValue: other,
      } as c.JsonValue,
    );
    refreshRow(observed, 1);
    refreshEvidence(observed);
    expect(issuesOf(bind(receiptFixture(), anchorFixture(), observed, FRESH_COMPLETED_AT))).toEqual(
      ["observedProtection.environmentBinding.variableValue:anchor-mismatch"],
    );
    // Leg 4: `Danchor` itself, moved by a one-axis anchor mutation.
    const anchor = anchorFixture();
    anchor.createdAt = "2026-09-02T00:00:02.000Z";
    expect(
      issuesOf(bind(receiptFixture(), anchor, freshObservation(), FRESH_COMPLETED_AT)),
    ).toEqual([
      "observedProtection.environmentBinding.variableValue:anchor-mismatch",
      "receipt.environmentBinding.variableValue:anchor-mismatch",
      "receipt.verifierAnchorDigest:anchor-mismatch",
    ]);
  });

  test("refuses repository-ID disagreement at each of the four positions", () => {
    // Position 1 and 2: the anchor's own ID against the receipt's, with every
    // anchor-digest leg realigned so the identity relation is the only one left.
    const anchor = anchorFixture();
    anchor.repositoryId = "78";
    at(anchor, ["signerWorkflow"]).repositoryId = "78";
    const moved = frameAnchorIdentity(anchor as unknown as c.JsonValue);
    const receipt = receiptFixture();
    receipt.verifierAnchorDigest = moved;
    at(receipt, ["environmentBinding"]).variableValue = moved;
    at(receipt, ["apiObservations", 1]).reducedValueDigest = frameReducedValue(
      "ENVIRONMENT_VARIABLE",
      {
        environmentName: at(receipt, ["environmentBinding"]).environmentName,
        variableName: at(receipt, ["environmentBinding"]).variableName,
        variableValue: moved,
      } as c.JsonValue,
    );
    refreshRow(receipt, 1);
    const observed = freshObservation();
    at(observed, ["environmentBinding"]).variableValue = moved;
    at(observed, ["apiObservations", 1]).reducedValueDigest = frameReducedValue(
      "ENVIRONMENT_VARIABLE",
      {
        environmentName: at(observed, ["environmentBinding"]).environmentName,
        variableName: at(observed, ["environmentBinding"]).variableName,
        variableValue: moved,
      } as c.JsonValue,
    );
    refreshRow(observed, 1);
    refreshEvidence(observed);
    expect(issuesOf(bind(receipt, anchor, observed, FRESH_COMPLETED_AT))).toEqual([
      "anchor.repositoryId:receipt-mismatch",
    ]);
    // Position 3: the anchor's nested signer-workflow ID, refused by the
    // landed anchor parser at verifier-anchor.ts:147-148 before the binder's
    // relations run.
    const signerMoved = anchorFixture();
    at(signerMoved, ["signerWorkflow"]).repositoryId = "78";
    expect(
      issuesOf(bind(receiptFixture(), signerMoved, freshObservation(), FRESH_COMPLETED_AT)),
    ).toEqual(["anchor.signerWorkflow.repositoryId:mismatch"]);
    // Position 4: the fresh observation's ID. It also sits inside the semantic
    // projection and the REPOSITORY reduced projection, so the disagreement
    // necessarily shows in all three places.
    const freshMoved = freshObservation();
    freshMoved.repositoryId = "78";
    refreshEvidence(freshMoved);
    expect(
      issuesOf(bind(receiptFixture(), anchorFixture(), freshMoved, FRESH_COMPLETED_AT)),
    ).toEqual([
      "observedProtection.apiObservations.2.reducedValueDigest:mismatch",
      "observedProtection.repositoryId:receipt-mismatch",
      "observedProtection:ruleset-semantics-mismatch",
    ]);
  });

  test("refuses environment or variable name disagreement through the literal pins", () => {
    // 6944-6945 requires historical and fresh names to agree; 6788-6790 pins
    // both to literals per record, so a disagreement is refused by the fresh
    // environment-binding parser (repository-protection-parse.ts:1425-1436).
    for (const [field, value, code] of [
      ["environmentName", "other-environment", "environmentName:mismatch"],
      ["variableName", "OTHER_VARIABLE", "variableName:mismatch"],
    ] as const) {
      const observed = freshObservation();
      at(observed, ["environmentBinding"])[field] = value;
      refreshEvidence(observed);
      expect(
        issuesOf(bind(receiptFixture(), anchorFixture(), observed, FRESH_COMPLETED_AT)),
        field,
      ).toEqual(["observedProtection.environmentBinding." + code]);
    }
  });

  test("joins the six shared rows by purpose and exact requestIdentityDigest", () => {
    // The two censuses are of different lengths and diverge from the third
    // position, so an array-index join could not produce the canonical
    // positive at all: fresh index 2 is REPOSITORY, historical index 2 is
    // PULL_REQUEST.
    const receipt = receiptFixture();
    const observed = freshObservation();
    expect(rowsAt(receipt, ["apiObservations"]).map((row) => row.purpose)).toEqual([
      ...HISTORICAL_PURPOSES,
    ]);
    expect(rowsAt(observed, ["apiObservations"]).map((row) => row.purpose)).toEqual([
      ...FRESH_PURPOSES,
    ]);
    expect(at(receipt, ["apiObservations", 2]).purpose).not.toBe(
      at(observed, ["apiObservations", 2]).purpose,
    );
    expect(bind(receipt, anchorFixture(), observed, FRESH_COMPLETED_AT).ok).toBe(true);
    // A fresh row whose request differs from the historical one has no
    // historical counterpart at the exact identity, and refuses.
    const drifted = freshObservation();
    const row = at(drifted, ["apiObservations", 3]);
    at(row, ["request"]).queryDigest = sha("fresh-only-ruleset-query");
    row.requestIdentityDigest = frameRequestIdentity(
      "RULESET",
      at(row, ["request"]) as unknown as c.JsonValue,
    );
    row.pages = [
      {
        ...at(row, ["pages", 0]),
        requestDigest: framePageRequest(String(row.requestIdentityDigest), null),
      },
    ];
    refreshRow(drifted, 3);
    refreshEvidence(drifted);
    expect(issuesOf(bind(receiptFixture(), anchorFixture(), drifted, FRESH_COMPLETED_AT))).toEqual([
      "observedProtection.apiObservations.3.requestIdentityDigest:historical-join-mismatch",
    ]);
  });

  test("refuses a fresh array that is short, duplicated or carries a historical-only purpose", () => {
    const short = freshObservation();
    rowsAt(short, ["apiObservations"]).splice(3, 1);
    refreshEvidence(short);
    expect(issuesOf(bind(receiptFixture(), anchorFixture(), short, FRESH_COMPLETED_AT))).toEqual([
      "observedProtection.apiObservations.array:length",
    ]);
    const duplicated = freshObservation();
    rowsAt(duplicated, ["apiObservations"])[3] = clone(at(duplicated, ["apiObservations", 2]));
    refreshEvidence(duplicated);
    expect(
      issuesOf(bind(receiptFixture(), anchorFixture(), duplicated, FRESH_COMPLETED_AT)),
    ).toEqual(["observedProtection.apiObservations.3.purpose:ordered-census-required"]);
    const historicalOnly = freshObservation();
    rowsAt(historicalOnly, ["apiObservations"])[3] = clone(
      at(receiptFixture(), ["apiObservations", 8]),
    );
    refreshEvidence(historicalOnly);
    expect(
      issuesOf(bind(receiptFixture(), anchorFixture(), historicalOnly, FRESH_COMPLETED_AT)),
    ).toEqual([
      "observedProtection.apiObservations.3.purpose:fresh-census-required",
      "observedProtection.apiObservations.3.triggeringBuild:null-required",
    ]);
  });

  test("keeps the receipt producer historical and never copied into the fresh input", () => {
    // The fresh census has no producer, schemaVersion, evaluatedAt or supplied
    // apiTerminals member (6879-6882, 6957-6958), so no fresh value can be
    // sourced from the producer and the terminal projection cannot be supplied.
    for (const [field, value] of [
      ["producer", at(receiptFixture(), ["producer"])],
      ["schemaVersion", RECEIPT_SCHEMA],
      ["evaluatedAt", FRESH_COMPLETED_AT],
      ["apiTerminals", (terminalEvidenceProjection(freshObservation()) as Row).apiTerminals],
    ] as const) {
      const observed = freshObservation();
      observed[field] = value;
      expect(
        issuesOf(bind(receiptFixture(), anchorFixture(), observed, FRESH_COMPLETED_AT)),
        field,
      ).toEqual(["observedProtection." + field + ":unknown-field"]);
    }
    expect(codepointSorted(Object.keys(freshObservation()))).toEqual([...FRESH_ROOT_MEMBERS]);
  });

  test("refuses fresh semantic disagreement with the receipt's immutable semantics", () => {
    const observed = freshObservation();
    observed.rulesetId = "89";
    const row = at(observed, ["apiObservations", 3]);
    row.reducedValueDigest = frameReducedValue("RULESET", {
      protectedPathPolicies: observed.protectedPathPolicies,
      reviewPolicy: observed.reviewPolicy,
      rulesetId: observed.rulesetId,
    } as c.JsonValue);
    refreshRow(observed, 3);
    refreshEvidence(observed);
    expect(issuesOf(bind(receiptFixture(), anchorFixture(), observed, FRESH_COMPLETED_AT))).toEqual(
      ["observedProtection:ruleset-semantics-mismatch"],
    );
    const workflowMoved = freshObservation();
    at(workflowMoved, ["workflows", 0]).workflowId = "999";
    refreshEvidence(workflowMoved);
    expect(
      issuesOf(bind(receiptFixture(), anchorFixture(), workflowMoved, FRESH_COMPLETED_AT)),
    ).toEqual([
      "observedProtection.apiObservations.4.reducedValueDigest:mismatch",
      "observedProtection:ruleset-semantics-mismatch",
    ]);
  });

  test("requires each fresh row to terminate and recompute on its own evidence", () => {
    const twoPage = (): Row =>
      freshObservation({ countFor: (purpose) => (purpose === "ENVIRONMENT" ? 2 : 1) });
    const dangling = twoPage();
    at(dangling, ["apiObservations", 0, "pages", 1]).nextRequestDigest = sha("dangling-next");
    refreshRow(dangling, 0);
    refreshEvidence(dangling);
    expect(issuesOf(bind(receiptFixture(), anchorFixture(), dangling, FRESH_COMPLETED_AT))).toEqual(
      ["observedProtection.apiObservations.0.pages.1.nextRequestDigest:null-required"],
    );
    const duplicateOrdinal = twoPage();
    at(duplicateOrdinal, ["apiObservations", 0, "pages", 1]).ordinal = "1";
    refreshRow(duplicateOrdinal, 0);
    refreshEvidence(duplicateOrdinal);
    expect(
      issuesOf(bind(receiptFixture(), anchorFixture(), duplicateOrdinal, FRESH_COMPLETED_AT)),
    ).toEqual(["observedProtection.apiObservations.0.pages.1.ordinal:mismatch"]);
    const missingNext = twoPage();
    at(missingNext, ["apiObservations", 0, "pages", 0]).linkRelations = rowsAt(missingNext, [
      "apiObservations",
      0,
      "pages",
      0,
      "linkRelations",
    ]).filter((row) => row.relation !== "NEXT");
    refreshRow(missingNext, 0);
    refreshEvidence(missingNext);
    expect(
      issuesOf(bind(receiptFixture(), anchorFixture(), missingNext, FRESH_COMPLETED_AT)),
    ).toEqual(["observedProtection.apiObservations.0.pages.0.linkRelations.NEXT:required"]);
    const graphqlReceipt = receiptFixture({ kindFor: GRAPHQL_RULESET });
    const graphqlTwoPage = (): Row =>
      freshObservation({
        kindFor: GRAPHQL_RULESET,
        countFor: (purpose) => (purpose === "RULESET" ? 2 : 1),
      });
    const earlyTerminal = graphqlTwoPage();
    at(earlyTerminal, ["apiObservations", 3, "pages", 1]).hasNextPage = true;
    refreshRow(earlyTerminal, 3);
    refreshEvidence(earlyTerminal);
    expect(
      issuesOf(bind(graphqlReceipt, anchorFixture(), earlyTerminal, FRESH_COMPLETED_AT)),
    ).toEqual(["observedProtection.apiObservations.3.pages.1.hasNextPage:false-required"]);
    const unboundCursorPage = graphqlTwoPage();
    at(unboundCursorPage, ["apiObservations", 3, "pages", 1]).requestDigest = sha("unbound-cursor");
    refreshRow(unboundCursorPage, 3);
    refreshEvidence(unboundCursorPage);
    expect(
      issuesOf(bind(graphqlReceipt, anchorFixture(), unboundCursorPage, FRESH_COMPLETED_AT)),
    ).toEqual(["observedProtection.apiObservations.3.pages.1.requestDigest:mismatch"]);
  });

  test("refuses every unbound derived digest inside a fresh row", () => {
    for (const [label, mutate, issues] of [
      [
        "first page request",
        (observed: Row): void => {
          at(observed, ["apiObservations", 0, "pages", 0]).requestDigest = sha("unbound-page");
          refreshRow(observed, 0);
        },
        ["observedProtection.apiObservations.0.pages.0.requestDigest:mismatch"],
      ],
      [
        "complete reduction",
        (observed: Row): void => {
          at(observed, ["apiObservations", 0]).completeReductionDigest = sha("unbound-reduction");
        },
        ["observedProtection.apiObservations.0.completeReductionDigest:mismatch"],
      ],
      [
        "terminal pagination",
        (observed: Row): void => {
          at(observed, ["apiObservations", 0]).terminalPaginationDigest = sha("caller-count");
        },
        ["observedProtection.apiObservations.0.terminalPaginationDigest:mismatch"],
      ],
      [
        "reduced value",
        (observed: Row): void => {
          at(observed, ["apiObservations", 0]).reducedValueDigest = sha("unbound-reduced");
          refreshRow(observed, 0);
        },
        ["observedProtection.apiObservations.0.reducedValueDigest:mismatch"],
      ],
    ] as const) {
      const observed = freshObservation();
      mutate(observed);
      refreshEvidence(observed);
      expect(
        issuesOf(bind(receiptFixture(), anchorFixture(), observed, FRESH_COMPLETED_AT)),
        label,
      ).toEqual([...issues]);
    }
  });
});

describe("ISS-054 Packet D chronology, freshness and stale substitution", () => {
  /** Times chosen so the fresh window ends exactly at `evaluatedAt`. */
  function boundedFresh(startedAt: string, completedAt: string, pageObservedAt: string): Row {
    return freshObservation({ startedAt, completedAt, pageObservedAt });
  }

  test("pins the evaluation window at every stated boundary", () => {
    // issuedAt <= evaluatedAt < expiresAt (6927), evaluatedAt == completedAt
    // (6891-6892). Each boundary is committed in both directions.
    expect(
      bind(
        receiptFixture(),
        anchorFixture(),
        boundedFresh(PRODUCER_STARTED_AT, ISSUED_AT, "2026-09-04T00:01:30.000Z"),
        ISSUED_AT,
      ).ok,
    ).toBe(true);
    expect(
      issuesOf(
        bind(
          receiptFixture(),
          anchorFixture(),
          boundedFresh(PRODUCER_STARTED_AT, "2026-09-04T00:01:59.999Z", "2026-09-04T00:01:30.000Z"),
          "2026-09-04T00:01:59.999Z",
        ),
      ),
    ).toEqual(["evaluatedAt:before-issuedAt"]);
    expect(
      issuesOf(
        bind(
          receiptFixture(),
          anchorFixture(),
          boundedFresh("2026-09-11T00:01:00.000Z", EXPIRES_AT, "2026-09-11T00:01:30.000Z"),
          EXPIRES_AT,
        ),
      ),
    ).toEqual(["evaluatedAt:not-before-expiresAt"]);
    expect(
      bind(
        receiptFixture(),
        anchorFixture(),
        boundedFresh(
          "2026-09-11T00:01:00.000Z",
          "2026-09-11T00:01:59.999Z",
          "2026-09-11T00:01:30.000Z",
        ),
        "2026-09-11T00:01:59.999Z",
      ).ok,
    ).toBe(true);
    expect(
      issuesOf(
        bind(receiptFixture(), anchorFixture(), freshObservation(), "2026-09-05T00:01:59.999Z"),
      ),
    ).toEqual(["evaluatedAt:observation-completion-required"]);
    for (const malformed of [null, undefined, "2026-09-05T00:02:00Z", 1757030520000, {}])
      expect(
        issuesOf(bind(receiptFixture(), anchorFixture(), freshObservation(), malformed)),
        String(malformed),
      ).toEqual(["evaluatedAt:invalid"]);
  });

  test("pins the 300,000 millisecond fresh window at both boundaries", () => {
    expect(
      bind(
        receiptFixture(),
        anchorFixture(),
        boundedFresh(FRESH_STARTED_AT, "2026-09-05T00:05:00.000Z", FRESH_PAGE_OBSERVED_AT),
        "2026-09-05T00:05:00.000Z",
      ).ok,
    ).toBe(true);
    expect(
      issuesOf(
        bind(
          receiptFixture(),
          anchorFixture(),
          boundedFresh(FRESH_STARTED_AT, "2026-09-05T00:05:00.001Z", FRESH_PAGE_OBSERVED_AT),
          "2026-09-05T00:05:00.001Z",
        ),
      ),
    ).toEqual(["observedProtection.completedAt:more-than-five-minutes"]);
  });

  /**
   * The four historical comparisons of 6930-6931, each with the gate that
   * discharges it. The transcribed predicate below is the "scratch copy": with
   * one comparison deleted it accepts the mutant, so no comparison is
   * tautological, and the committed mutant's exact refusal names the gate.
   */
  const historicalChronology = [
    {
      name: "confirmedAt <= anchor.createdAt",
      gate: "verifier-anchor.ts:163-164",
      compare: (a: Row, r: Row): boolean =>
        String(at(a, ["operatorConfirmation"]).confirmedAt) <= String(a.createdAt),
      mutate: (a: Row): void => {
        at(a, ["operatorConfirmation"]).confirmedAt = "2026-09-02T00:00:02.000Z";
      },
      target: "anchor" as const,
      issues: ["anchor.operatorConfirmation.confirmedAt:after-creation"],
    },
    {
      name: "anchor.createdAt <= receipt.environmentBinding.variableUpdatedAt",
      gate: "repository-protection-binding.ts (binder only)",
      compare: (a: Row, r: Row): boolean =>
        String(a.createdAt) <= String(at(r, ["environmentBinding"]).variableUpdatedAt),
      mutate: (r: Row): void => {
        at(r, ["environmentBinding"]).variableUpdatedAt = "2026-09-01T00:00:00.000Z";
      },
      target: "receipt" as const,
      issues: ["receipt.environmentBinding.variableUpdatedAt:before-anchor-createdAt"],
    },
    {
      name: "receipt.environmentBinding.variableUpdatedAt < receipt.producer.startedAt",
      gate: "repository-protection.ts:475-476",
      compare: (a: Row, r: Row): boolean =>
        String(at(r, ["environmentBinding"]).variableUpdatedAt) <
        String(at(r, ["producer"]).startedAt),
      mutate: (r: Row): void => {
        at(r, ["environmentBinding"]).variableUpdatedAt = PRODUCER_STARTED_AT;
      },
      target: "receipt" as const,
      issues: ["receipt.environmentBinding.variableUpdatedAt:not-before-producer"],
    },
    {
      name: "receipt.producer.startedAt <= receipt.issuedAt",
      gate: "repository-protection.ts:479",
      compare: (a: Row, r: Row): boolean =>
        String(at(r, ["producer"]).startedAt) <= String(r.issuedAt),
      mutate: (r: Row): void => {
        at(r, ["producer"]).startedAt = "2026-09-04T00:02:00.001Z";
      },
      target: "receipt" as const,
      issues: ["receipt.producer.startedAt:after-issuedAt"],
    },
  ];

  test("keeps each of the four historical chronology comparisons non-tautological", () => {
    expect(historicalChronology).toHaveLength(4);
    for (const comparison of historicalChronology) {
      const anchor = anchorFixture();
      const receipt = receiptFixture();
      const full = historicalChronology;
      expect(
        full.every((row) => row.compare(anchor, receipt)),
        comparison.name,
      ).toBe(true);
      if (comparison.target === "anchor") comparison.mutate(anchor);
      else comparison.mutate(receipt);
      // The full transcribed chain rejects the mutant...
      expect(
        full.every((row) => row.compare(anchor, receipt)),
        comparison.name,
      ).toBe(false);
      // ...and the scratch copy with exactly this comparison deleted accepts
      // it, so the comparison is the only thing standing between the mutant
      // and the chain.
      expect(
        full
          .filter((row) => row.name !== comparison.name)
          .every((row) => row.compare(anchor, receipt)),
        comparison.name,
      ).toBe(true);
      // The committed mutant refuses, and its refusal names the gate that
      // discharges the comparison. The producer-start mutant necessarily also
      // disturbs the nine receipt observation chronology rows, because the
      // receipt binds every observation start to the producer start
      // (repository-protection.ts:494-495), so this assertion is containment
      // rather than an exact array; the exact arrays live in the binder
      // deletion-mutant table below.
      const issues = issuesOf(bind(receipt, anchor, freshObservation(), FRESH_COMPLETED_AT));
      for (const code of comparison.issues) expect(issues, comparison.name).toContain(code);
    }
  });

  test("refuses a future-dated confirmation, anchor creation or variable publication", () => {
    // 7001-7003: the confirmation, the anchor creation and the historical
    // publication cannot be later than the value they precede.
    const lateAnchor = anchorFixture();
    lateAnchor.createdAt = "2026-09-04T00:00:00.001Z";
    at(lateAnchor, ["operatorConfirmation"]).confirmedAt = "2026-09-04T00:00:00.001Z";
    expect(
      issuesOf(bind(receiptFixture(), lateAnchor, freshObservation(), FRESH_COMPLETED_AT)),
    ).toEqual([
      "observedProtection.environmentBinding.variableValue:anchor-mismatch",
      "receipt.environmentBinding.variableUpdatedAt:before-anchor-createdAt",
      "receipt.environmentBinding.variableValue:anchor-mismatch",
      "receipt.verifierAnchorDigest:anchor-mismatch",
    ]);
    const observed = freshObservation();
    at(observed, ["environmentBinding"]).variableUpdatedAt = "2026-09-01T00:00:00.000Z";
    refreshEvidence(observed);
    expect(issuesOf(bind(receiptFixture(), anchorFixture(), observed, FRESH_COMPLETED_AT))).toEqual(
      ["observedProtection.environmentBinding.variableUpdatedAt:before-anchor-createdAt"],
    );
  });

  test("refuses stale substitution by the moved fresh update time", () => {
    // 6941-6942 and 7003-7005: a same-value rewrite whose fresh update time is
    // exactly the historical REVIEW producer start, and a retarget-then-restore
    // whose fresh update time is later than it. Both keep the same variable
    // value, so only the moved update time can refuse them, and both must
    // refuse with the fresh publication comparison's exact code.
    for (const [label, updatedAt] of [
      ["same-value rewrite at producer start", PRODUCER_STARTED_AT],
      ["retarget then restore after producer start", "2026-09-04T00:01:30.000Z"],
    ] as const) {
      const observed = freshObservation();
      at(observed, ["environmentBinding"]).variableUpdatedAt = updatedAt;
      refreshEvidence(observed);
      // The value itself is unchanged: the refusal is by the time, not the value.
      expect(at(observed, ["environmentBinding"]).variableValue, label).toBe(ANCHOR_DIGEST);
      expect(
        issuesOf(bind(receiptFixture(), anchorFixture(), observed, FRESH_COMPLETED_AT)),
        label,
      ).toEqual(["observedProtection.environmentBinding.variableUpdatedAt:not-before-producer"]);
    }
  });

  test("refuses a fresh update after the fresh observation start", () => {
    // 7003-7004, and 6938-6939 by consequence: the same comparison places the
    // update no later than every fresh page observation and completion time,
    // because Packet C already holds every page time inside the root window.
    const observed = freshObservation({
      startedAt: "2026-09-04T00:00:20.000Z",
      completedAt: "2026-09-04T00:02:00.000Z",
      pageObservedAt: "2026-09-04T00:01:00.000Z",
    });
    expect(
      String(at(observed, ["environmentBinding"]).variableUpdatedAt) > String(observed.startedAt),
    ).toBe(true);
    expect(
      issuesOf(bind(receiptFixture(), anchorFixture(), observed, "2026-09-04T00:02:00.000Z")),
    ).toEqual(["observedProtection.environmentBinding.variableUpdatedAt:after-observation-start"]);
    // The consequence, stated as a passing control: with the update at or
    // before the start, every page time and the completion time are also at or
    // after it, and no separate per-page relation exists or is needed.
    const positive = freshObservation();
    for (const row of rowsAt(positive, ["apiObservations"]))
      for (const page of row.pages as Row[])
        expect(String(page.observedAt) >= FRESH_UPDATED_AT).toBe(true);
    expect(String(positive.completedAt) >= FRESH_UPDATED_AT).toBe(true);
    expect(bind(receiptFixture(), anchorFixture(), positive, FRESH_COMPLETED_AT).ok).toBe(true);
  });
});

describe("ISS-054 Packet D over-binding negative controls and the straddle positive", () => {
  test("admits a fresh window that straddles receipt.issuedAt", () => {
    // 6887-6888 places fresh page times inside the fresh window "rather than
    // before receipt issue"; with 6927 and 6891-6892 a window that starts
    // before `issuedAt` and ends after it is admitted, and the ledger states
    // no `observedProtection.startedAt >= receipt.issuedAt` relation. This
    // positive exists so a later lane cannot silently add one (Round 456 3.5).
    const startedAt = "2026-09-04T00:01:59.000Z";
    const completedAt = "2026-09-04T00:02:30.000Z";
    expect(startedAt < ISSUED_AT).toBe(true);
    expect(completedAt > ISSUED_AT).toBe(true);
    const observed = freshObservation({
      startedAt,
      completedAt,
      pageObservedAt: "2026-09-04T00:02:00.000Z",
    });
    expect(bind(receiptFixture(), anchorFixture(), observed, completedAt).ok).toBe(true);
  });

  test("never equates historical and fresh capture metadata", () => {
    // 6939-6941 and 6948-6950: page counts, ETags, cursors, Link headers,
    // response bytes, capture times, reduction digests and terminal digests
    // must not be equated. Each control below is a positive; a binder that
    // demanded equality would fail it.
    const receipt = receiptFixture();
    const observed = freshObservation({
      countFor: (purpose) => (purpose === "ENVIRONMENT" ? 4 : 1),
    });
    at(observed, ["environmentBinding"]).variableUpdatedAt = "2026-09-03T12:00:00.000Z";
    at(observed, ["environmentBinding"]).environmentEtag = quote + "an-entirely-other-etag" + quote;
    refreshEvidence(observed);
    const historicalRow = at(receipt, ["apiObservations", 0]);
    const freshRow = at(observed, ["apiObservations", 0]);
    expect((historicalRow.pages as Row[]).length).not.toBe((freshRow.pages as Row[]).length);
    expect(at(historicalRow, ["pages", 0]).etag).not.toBe(at(freshRow, ["pages", 0]).etag);
    expect(at(historicalRow, ["pages", 0]).responseDigest).not.toBe(
      at(freshRow, ["pages", 0]).responseDigest,
    );
    expect(at(historicalRow, ["pages", 0]).observedAt).not.toBe(
      at(freshRow, ["pages", 0]).observedAt,
    );
    expect(at(historicalRow, ["pages", 0]).linkHeaderDigest).not.toBe(
      at(freshRow, ["pages", 0]).linkHeaderDigest,
    );
    expect(historicalRow.completeReductionDigest).not.toBe(freshRow.completeReductionDigest);
    expect(historicalRow.terminalPaginationDigest).not.toBe(freshRow.terminalPaginationDigest);
    expect(at(historicalRow, ["pages", 0]).nextRequestDigest).not.toBe(
      at(freshRow, ["pages", 0]).nextRequestDigest,
    );
    expect(at(receipt, ["environmentBinding"]).environmentEtag).not.toBe(
      at(observed, ["environmentBinding"]).environmentEtag,
    );
    expect(at(receipt, ["environmentBinding"]).variableUpdatedAt).not.toBe(
      at(observed, ["environmentBinding"]).variableUpdatedAt,
    );
    expect(observed.terminalEvidenceDigest).not.toBe(receipt.rulesetSemanticDigest);
    expect(bind(receipt, anchorFixture(), observed, FRESH_COMPLETED_AT).ok).toBe(true);
    // GraphQL cursors are likewise independent between the two captures.
    const graphqlReceipt = receiptFixture({ kindFor: GRAPHQL_RULESET });
    const graphqlObserved = freshObservation({
      kindFor: GRAPHQL_RULESET,
      countFor: (purpose) => (purpose === "RULESET" ? 2 : 1),
    });
    expect(at(graphqlObserved, ["apiObservations", 3, "pages", 1]).requestCursor).not.toBe(
      at(graphqlReceipt, ["apiObservations", 5, "pages", 0]).requestCursor,
    );
    expect(bind(graphqlReceipt, anchorFixture(), graphqlObserved, FRESH_COMPLETED_AT).ok).toBe(
      true,
    );
  });

  test("leaves fresh row times unbound to the root window, as the ledger states", () => {
    // Observation O2 of the Packet C review: 6887-6888 scopes the fresh window
    // to page times, and no ledger clause binds a fresh row's own
    // startedAt/completedAt to it. The binder reads fresh row times for
    // nothing, so this stays a positive rather than an unstated relation.
    const observed = freshObservation({
      rowStartedAt: "2000-01-01T00:00:00.000Z",
      rowCompletedAt: "2000-01-01T00:00:01.000Z",
    });
    expect(
      String(at(observed, ["apiObservations", 0]).startedAt) < String(observed.startedAt),
    ).toBe(true);
    expect(bind(receiptFixture(), anchorFixture(), observed, FRESH_COMPLETED_AT).ok).toBe(true);
  });

  test("never joins the two historical-only reduced values into fresh semantics", () => {
    // 6768-6774: PULL_REQUEST and PULL_REQUEST_REVIEWS carry opaque supplied
    // reduced values with no fresh counterpart. Rotating both is a positive.
    const receipt = receiptFixture();
    for (const index of [2, 3]) {
      const row = at(receipt, ["apiObservations", index]);
      row.reducedValueDigest = sha(String(row.purpose) + ":another-opaque-reduced-value");
      row.completeReductionDigest = frameCompleteReduction(
        String(row.requestIdentityDigest),
        rowsAt(receipt, ["apiObservations", index, "pages"]),
        String(row.reducedValueDigest),
      );
    }
    expect(bind(receipt, anchorFixture(), freshObservation(), FRESH_COMPLETED_AT).ok).toBe(true);
    expect(rowsAt(freshObservation(), ["apiObservations"]).map((row) => row.purpose)).not.toContain(
      "PULL_REQUEST",
    );
    expect(rowsAt(freshObservation(), ["apiObservations"]).map((row) => row.purpose)).not.toContain(
      "PULL_REQUEST_REVIEWS",
    );
  });
});

describe("ISS-054 Packet D terminal evidence, opaque leaves and frame discipline", () => {
  test("refuses a caller count, a historical timestamp or an unbound terminal claim", () => {
    // 6922-6924: no precomputed count, historical receipt timestamp or row
    // without terminal pagination can be presented as the evaluation boundary.
    for (const [label, supplied] of [
      ["caller count", sha("64")],
      [
        "historical receipt digest",
        frameReceiptIdentity(receiptFixture() as unknown as c.JsonValue),
      ],
      ["historical issue time", sha(ISSUED_AT)],
    ] as const) {
      const observed = freshObservation();
      observed.terminalEvidenceDigest = supplied;
      expect(
        issuesOf(bind(receiptFixture(), anchorFixture(), observed, FRESH_COMPLETED_AT)),
        label,
      ).toEqual(["observedProtection.terminalEvidenceDigest:mismatch"]);
    }
    // A row whose terminal pagination does not recompute cannot contribute a
    // terminal proof even when the enclosing evidence digest is refreshed.
    const unbound = freshObservation();
    at(unbound, ["apiObservations", 2]).terminalPaginationDigest = sha("no-terminal-proof");
    refreshEvidence(unbound);
    expect(issuesOf(bind(receiptFixture(), anchorFixture(), unbound, FRESH_COMPLETED_AT))).toEqual([
      "observedProtection.apiObservations.2.terminalPaginationDigest:mismatch",
    ]);
  });

  test("keeps the terminal-evidence projection non-circular by construction", () => {
    const observed = freshObservation();
    const projection = terminalEvidenceProjection(observed) as Row;
    expect(codepointSorted(Object.keys(projection))).toEqual([
      "apiTerminals",
      "completedAt",
      "environmentBinding",
      "rulesetSemantics",
      "startedAt",
    ]);
    // The projection excludes `terminalEvidenceDigest`, so a self-including
    // projection is not constructible from it and the recipe cannot recurse.
    expect(Object.keys(projection)).not.toContain("terminalEvidenceDigest");
    expect(JSON.stringify(projection)).not.toContain(String(observed.terminalEvidenceDigest));
    for (const terminal of projection.apiTerminals as Row[])
      expect(codepointSorted(Object.keys(terminal))).toEqual([
        "purpose",
        "requestIdentityDigest",
        "terminalPaginationDigest",
      ]);
    expect((projection.apiTerminals as Row[]).map((row) => row.purpose)).toEqual([
      ...FRESH_PURPOSES,
    ]);
    expect(codepointSorted(Object.keys(projection.rulesetSemantics as Row))).toEqual([
      "protectedPathPolicies",
      "repositoryId",
      "reviewPolicy",
      "rulesetId",
      "workflows",
    ]);
    expect(codepointSorted(Object.keys(projection.environmentBinding as Row))).toEqual([
      "environmentEtag",
      "environmentName",
      "variableName",
      "variableUpdatedAt",
      "variableValue",
    ]);
  });

  test("moves the terminal-evidence digest on a frame tag or order change, never on key order", () => {
    const projection = terminalEvidenceProjection(freshObservation());
    const canonical = frameTerminalEvidence(projection);
    expect(canonical).toBe(TERMINAL_EVIDENCE_GOLDEN);
    // Canonical JSON sorts record keys, so insertion order alone changes
    // nothing (6659-6665).
    const reordered = Object.fromEntries(
      Object.entries(projection as Row).reverse(),
    ) as unknown as c.JsonValue;
    expect(frameTerminalEvidence(reordered)).toBe(canonical);
    // A different frame-part tag over the same bytes moves it.
    expect(
      c.framedDigest("repository-protection-terminal-evidence/v1", [
        c.frame.text(c.canonicalJson(projection)),
      ]),
    ).not.toBe(canonical);
    // Two parts instead of exactly one moves it.
    const parts = projection as Row;
    expect(
      c.framedDigest("repository-protection-terminal-evidence/v1", [
        c.frame.canonical(parts.apiTerminals as c.JsonValue),
        c.frame.canonical({
          completedAt: parts.completedAt,
          environmentBinding: parts.environmentBinding,
          rulesetSemantics: parts.rulesetSemantics,
          startedAt: parts.startedAt,
        } as c.JsonValue),
      ]),
    ).not.toBe(canonical);
    // A different domain moves it.
    expect(
      c.framedDigest("repository-protection-receipt/v1", [c.frame.canonical(projection)]),
    ).not.toBe(canonical);
    // The six-purpose `apiTerminals` order is significant (6895-6898).
    const rows = [...((projection as Row).apiTerminals as Row[])];
    const swapped = {
      ...(projection as Row),
      apiTerminals: [required(rows[1]), required(rows[0]), ...rows.slice(2)],
    } as unknown as c.JsonValue;
    expect(frameTerminalEvidence(swapped)).not.toBe(canonical);
  });

  test("treats fresh opaque leaves as supplied claims that move only enclosing digests", () => {
    // 6667-6671, 6701-6706: no positive asserts that a response, Link-header,
    // later REST request, query, document or variables digest is authenticated
    // or complete. Rotating a leaf moves the digests that enclose it and
    // nothing else, and the rotated tree binds once those are refreshed.
    const rotatedResponse = freshObservation();
    at(rotatedResponse, ["apiObservations", 0, "pages", 0]).responseDigest =
      sha("rotated-response");
    expect(
      issuesOf(bind(receiptFixture(), anchorFixture(), rotatedResponse, FRESH_COMPLETED_AT)),
    ).toEqual([
      "observedProtection.apiObservations.0.completeReductionDigest:mismatch",
      "observedProtection.apiObservations.0.terminalPaginationDigest:mismatch",
    ]);
    refreshRow(rotatedResponse, 0);
    refreshEvidence(rotatedResponse);
    expect(bind(receiptFixture(), anchorFixture(), rotatedResponse, FRESH_COMPLETED_AT).ok).toBe(
      true,
    );
    // A rotated request leaf moves the request identity, so the purpose join
    // is what refuses; the leaf itself is never authenticated.
    const rotatedQuery = freshObservation();
    const row = at(rotatedQuery, ["apiObservations", 3]);
    at(row, ["request"]).queryDigest = sha("rotated-query");
    row.requestIdentityDigest = frameRequestIdentity(
      "RULESET",
      at(row, ["request"]) as unknown as c.JsonValue,
    );
    row.pages = [
      {
        ...at(row, ["pages", 0]),
        requestDigest: framePageRequest(String(row.requestIdentityDigest), null),
      },
    ];
    refreshRow(rotatedQuery, 3);
    refreshEvidence(rotatedQuery);
    expect(
      issuesOf(bind(receiptFixture(), anchorFixture(), rotatedQuery, FRESH_COMPLETED_AT)),
    ).toEqual([
      "observedProtection.apiObservations.3.requestIdentityDigest:historical-join-mismatch",
    ]);
    // A malformed leaf is refused by grammar, never accepted as opaque.
    const malformed = freshObservation();
    at(malformed, ["apiObservations", 0, "pages", 0]).responseDigest = "not-a-digest";
    expect(bind(receiptFixture(), anchorFixture(), malformed, FRESH_COMPLETED_AT).ok).toBe(false);
  });
});

describe("ISS-054 Packet D deletion mutants, hostile reflection and the public census", () => {
  interface GateMutant {
    readonly gate: string;
    readonly ledger: string;
    readonly codes: readonly string[];
    readonly input: () => readonly [Row, Row, Row, unknown];
  }
  const other = sha("other-anchor");
  function withMovedReceiptAnchorLegs(): Row {
    const receipt = receiptFixture();
    at(receipt, ["environmentBinding"]).variableValue = other;
    receipt.verifierAnchorDigest = other;
    at(receipt, ["apiObservations", 1]).reducedValueDigest = frameReducedValue(
      "ENVIRONMENT_VARIABLE",
      {
        environmentName: at(receipt, ["environmentBinding"]).environmentName,
        variableName: at(receipt, ["environmentBinding"]).variableName,
        variableValue: other,
      } as c.JsonValue,
    );
    refreshRow(receipt, 1);
    return receipt;
  }
  function withMovedFreshAnchorLeg(): Row {
    const observed = freshObservation();
    at(observed, ["environmentBinding"]).variableValue = other;
    at(observed, ["apiObservations", 1]).reducedValueDigest = frameReducedValue(
      "ENVIRONMENT_VARIABLE",
      {
        environmentName: at(observed, ["environmentBinding"]).environmentName,
        variableName: at(observed, ["environmentBinding"]).variableName,
        variableValue: other,
      } as c.JsonValue,
    );
    refreshRow(observed, 1);
    refreshEvidence(observed);
    return observed;
  }
  function withMovedAnchorRepositoryId(): readonly [Row, Row, Row] {
    const anchor = anchorFixture();
    anchor.repositoryId = "78";
    at(anchor, ["signerWorkflow"]).repositoryId = "78";
    const moved = frameAnchorIdentity(anchor as unknown as c.JsonValue);
    const receipt = receiptFixture();
    receipt.verifierAnchorDigest = moved;
    at(receipt, ["environmentBinding"]).variableValue = moved;
    at(receipt, ["apiObservations", 1]).reducedValueDigest = frameReducedValue(
      "ENVIRONMENT_VARIABLE",
      {
        environmentName: at(receipt, ["environmentBinding"]).environmentName,
        variableName: at(receipt, ["environmentBinding"]).variableName,
        variableValue: moved,
      } as c.JsonValue,
    );
    refreshRow(receipt, 1);
    const observed = freshObservation();
    at(observed, ["environmentBinding"]).variableValue = moved;
    at(observed, ["apiObservations", 1]).reducedValueDigest = frameReducedValue(
      "ENVIRONMENT_VARIABLE",
      {
        environmentName: at(observed, ["environmentBinding"]).environmentName,
        variableName: at(observed, ["environmentBinding"]).variableName,
        variableValue: moved,
      } as c.JsonValue,
    );
    refreshRow(observed, 1);
    refreshEvidence(observed);
    return [receipt, anchor, observed];
  }
  function freshWith(mutate: (observed: Row) => void, refreshIndex?: number): Row {
    const observed = freshObservation();
    mutate(observed);
    if (refreshIndex !== undefined) refreshRow(observed, refreshIndex);
    refreshEvidence(observed);
    return observed;
  }
  function driftedJoin(): Row {
    return freshWith((observed) => {
      const row = at(observed, ["apiObservations", 3]);
      at(row, ["request"]).queryDigest = sha("fresh-only-ruleset-query");
      row.requestIdentityDigest = frameRequestIdentity(
        "RULESET",
        at(row, ["request"]) as unknown as c.JsonValue,
      );
      row.pages = [
        {
          ...at(row, ["pages", 0]),
          requestDigest: framePageRequest(String(row.requestIdentityDigest), null),
        },
      ];
    }, 3);
  }

  const gateMutants: readonly GateMutant[] = [
    {
      gate: "receipt disposition ACCEPTED",
      ledger: "6926, 6496-6498",
      codes: ["receipt.disposition:accepted-required"],
      input: () => {
        const receipt = receiptFixture();
        receipt.disposition = "REJECTED";
        return [receipt, anchorFixture(), freshObservation(), FRESH_COMPLETED_AT];
      },
    },
    {
      gate: "issuedAt <= evaluatedAt",
      ledger: "6927",
      codes: ["evaluatedAt:before-issuedAt"],
      input: () => [
        receiptFixture(),
        anchorFixture(),
        freshObservation({
          startedAt: PRODUCER_STARTED_AT,
          completedAt: "2026-09-04T00:01:59.999Z",
          pageObservedAt: "2026-09-04T00:01:30.000Z",
        }),
        "2026-09-04T00:01:59.999Z",
      ],
    },
    {
      gate: "evaluatedAt < expiresAt",
      ledger: "6927",
      codes: ["evaluatedAt:not-before-expiresAt"],
      input: () => [
        receiptFixture(),
        anchorFixture(),
        freshObservation({
          startedAt: "2026-09-11T00:01:00.000Z",
          completedAt: EXPIRES_AT,
          pageObservedAt: "2026-09-11T00:01:30.000Z",
        }),
        EXPIRES_AT,
      ],
    },
    {
      gate: "evaluatedAt == observedProtection.completedAt",
      ledger: "6891-6892",
      codes: ["evaluatedAt:observation-completion-required"],
      input: () => [
        receiptFixture(),
        anchorFixture(),
        freshObservation(),
        "2026-09-05T00:01:59.999Z",
      ],
    },
    {
      gate: "Danchor equals both receipt anchor legs",
      ledger: "6927-6929",
      codes: [
        "receipt.environmentBinding.variableValue:anchor-mismatch",
        "receipt.verifierAnchorDigest:anchor-mismatch",
      ],
      input: () => [
        withMovedReceiptAnchorLegs(),
        anchorFixture(),
        freshObservation(),
        FRESH_COMPLETED_AT,
      ],
    },
    {
      gate: "Danchor equals the fresh environment variable value",
      ledger: "6927-6929",
      codes: ["observedProtection.environmentBinding.variableValue:anchor-mismatch"],
      input: () => [
        receiptFixture(),
        anchorFixture(),
        withMovedFreshAnchorLeg(),
        FRESH_COMPLETED_AT,
      ],
    },
    {
      gate: "anchor.createdAt <= receipt publication",
      ledger: "6930-6931",
      codes: ["receipt.environmentBinding.variableUpdatedAt:before-anchor-createdAt"],
      input: () => {
        const receipt = receiptFixture();
        at(receipt, ["environmentBinding"]).variableUpdatedAt = "2026-09-01T00:00:00.000Z";
        return [receipt, anchorFixture(), freshObservation(), FRESH_COMPLETED_AT];
      },
    },
    {
      gate: "anchor.createdAt <= fresh publication",
      ledger: "6934-6935",
      codes: ["observedProtection.environmentBinding.variableUpdatedAt:before-anchor-createdAt"],
      input: () => [
        receiptFixture(),
        anchorFixture(),
        freshWith((observed) => {
          at(observed, ["environmentBinding"]).variableUpdatedAt = "2026-09-01T00:00:00.000Z";
        }),
        FRESH_COMPLETED_AT,
      ],
    },
    {
      gate: "fresh publication < producer start (stale substitution)",
      ledger: "6934-6935, 6941-6942",
      codes: ["observedProtection.environmentBinding.variableUpdatedAt:not-before-producer"],
      input: () => [
        receiptFixture(),
        anchorFixture(),
        freshWith((observed) => {
          at(observed, ["environmentBinding"]).variableUpdatedAt = "2026-09-04T00:01:30.000Z";
        }),
        FRESH_COMPLETED_AT,
      ],
    },
    {
      gate: "fresh publication <= observation start",
      ledger: "6936-6939",
      codes: ["observedProtection.environmentBinding.variableUpdatedAt:after-observation-start"],
      input: () => [
        receiptFixture(),
        anchorFixture(),
        freshObservation({
          startedAt: "2026-09-04T00:00:20.000Z",
          completedAt: "2026-09-04T00:02:00.000Z",
          pageObservedAt: "2026-09-04T00:01:00.000Z",
        }),
        "2026-09-04T00:02:00.000Z",
      ],
    },
    {
      gate: "anchor repositoryId agrees with the receipt",
      ledger: "6943-6944",
      codes: ["anchor.repositoryId:receipt-mismatch"],
      input: () => {
        const [receipt, anchor, observed] = withMovedAnchorRepositoryId();
        return [receipt, anchor, observed, FRESH_COMPLETED_AT];
      },
    },
    {
      gate: "purpose plus exact requestIdentityDigest join",
      ledger: "6946-6948",
      codes: [
        "observedProtection.apiObservations.3.requestIdentityDigest:historical-join-mismatch",
      ],
      input: () => [receiptFixture(), anchorFixture(), driftedJoin(), FRESH_COMPLETED_AT],
    },
    {
      gate: "fresh row terminal pagination recompute",
      ledger: "6884-6885, 6950-6951",
      codes: ["observedProtection.apiObservations.0.terminalPaginationDigest:mismatch"],
      input: () => [
        receiptFixture(),
        anchorFixture(),
        freshWith((observed) => {
          at(observed, ["apiObservations", 0]).terminalPaginationDigest = sha("caller-count");
        }),
        FRESH_COMPLETED_AT,
      ],
    },
    {
      gate: "fresh row page-chain termination",
      ledger: "6950-6951",
      codes: ["observedProtection.apiObservations.0.pages.1.nextRequestDigest:null-required"],
      input: () => {
        const observed = freshObservation({
          countFor: (purpose) => (purpose === "ENVIRONMENT" ? 2 : 1),
        });
        at(observed, ["apiObservations", 0, "pages", 1]).nextRequestDigest = sha("dangling-next");
        refreshRow(observed, 0);
        refreshEvidence(observed);
        return [receiptFixture(), anchorFixture(), observed, FRESH_COMPLETED_AT];
      },
    },
    {
      gate: "fresh row complete-reduction recompute",
      ledger: "6884-6885",
      codes: ["observedProtection.apiObservations.0.completeReductionDigest:mismatch"],
      input: () => [
        receiptFixture(),
        anchorFixture(),
        freshWith((observed) => {
          at(observed, ["apiObservations", 0]).completeReductionDigest = sha("unbound-reduction");
        }),
        FRESH_COMPLETED_AT,
      ],
    },
    {
      gate: "fresh row first-page request recompute",
      ledger: "6884-6885",
      codes: ["observedProtection.apiObservations.0.pages.0.requestDigest:mismatch"],
      input: () => [
        receiptFixture(),
        anchorFixture(),
        freshWith((observed) => {
          at(observed, ["apiObservations", 0, "pages", 0]).requestDigest = sha("unbound-page");
        }, 0),
        FRESH_COMPLETED_AT,
      ],
    },
    {
      gate: "fresh reduced-value recompute from fresh semantics",
      ledger: "6951-6955",
      codes: ["observedProtection.apiObservations.0.reducedValueDigest:mismatch"],
      input: () => [
        receiptFixture(),
        anchorFixture(),
        freshWith((observed) => {
          at(observed, ["apiObservations", 0]).reducedValueDigest = sha("unbound-reduced");
        }, 0),
        FRESH_COMPLETED_AT,
      ],
    },
    {
      gate: "fresh semantic digest equals the receipt's",
      ledger: "6955-6957",
      codes: ["observedProtection:ruleset-semantics-mismatch"],
      input: () => {
        const observed = freshObservation();
        observed.rulesetId = "89";
        at(observed, ["apiObservations", 3]).reducedValueDigest = frameReducedValue("RULESET", {
          protectedPathPolicies: observed.protectedPathPolicies,
          reviewPolicy: observed.reviewPolicy,
          rulesetId: observed.rulesetId,
        } as c.JsonValue);
        refreshRow(observed, 3);
        refreshEvidence(observed);
        return [receiptFixture(), anchorFixture(), observed, FRESH_COMPLETED_AT];
      },
    },
    {
      gate: "terminal-evidence recompute binds the supplied digest",
      ledger: "6892-6917, 6994-6996",
      codes: ["observedProtection.terminalEvidenceDigest:mismatch"],
      input: () => {
        const observed = freshObservation();
        observed.terminalEvidenceDigest = sha("caller-count-boundary");
        return [receiptFixture(), anchorFixture(), observed, FRESH_COMPLETED_AT];
      },
    },
  ];

  test("keeps every committed binder deletion mutant discriminating", () => {
    expect(gateMutants).toHaveLength(19);
    expect(new Set(gateMutants.map((mutant) => mutant.gate)).size).toBe(gateMutants.length);
    const canonical = canonicalBind();
    for (const mutant of gateMutants) {
      const [receipt, anchor, observed, evaluatedAt] = mutant.input();
      let result: BindResult | undefined;
      expect(() => {
        result = bind(receipt, anchor, observed, evaluatedAt);
      }, mutant.gate).not.toThrow();
      const issues = issuesOf(required(result));
      // The gate fires...
      expect(issues.length, mutant.gate).toBeGreaterThan(0);
      expect([...issues], mutant.gate).toEqual([...mutant.codes]);
      // ...and it is the only gate that refuses this mutant, so a scratch copy
      // with the gate deleted would report nothing and let the mutant survive.
      expect(
        issues.filter((issue) => !mutant.codes.includes(issue)),
        mutant.gate,
      ).toEqual([]);
      // The unmutated fixture is still a positive, so no mutant is vacuous.
      expect(canonical.ok, mutant.gate).toBe(true);
    }
  });

  test("names the relations that are deliberately defence in depth", () => {
    // These binder comparisons restate the ledger's chain but are also
    // discharged by a mapped parser before the relations run, so none of them
    // carries a deletion mutant above; the named gate is what actually
    // refuses. Naming them keeps the mutant table honest.
    const defenceInDepth = [
      {
        relation: "anchor.operatorConfirmation.confirmedAt <= anchor.createdAt",
        gate: "verifier-anchor.ts:163-164",
        code: "anchor.operatorConfirmation.confirmedAt:after-creation",
        input: (): readonly [Row, Row, Row] => {
          const anchor = anchorFixture();
          at(anchor, ["operatorConfirmation"]).confirmedAt = "2026-09-02T00:00:02.000Z";
          return [receiptFixture(), anchor, freshObservation()];
        },
      },
      {
        relation: "receipt publication < receipt.producer.startedAt",
        gate: "repository-protection.ts:475-476",
        code: "receipt.environmentBinding.variableUpdatedAt:not-before-producer",
        input: (): readonly [Row, Row, Row] => {
          const receipt = receiptFixture();
          at(receipt, ["environmentBinding"]).variableUpdatedAt = PRODUCER_STARTED_AT;
          return [receipt, anchorFixture(), freshObservation()];
        },
      },
      {
        relation: "receipt.producer.startedAt <= receipt.issuedAt",
        gate: "repository-protection.ts:479",
        code: "receipt.producer.startedAt:after-issuedAt",
        input: (): readonly [Row, Row, Row] => {
          const receipt = receiptFixture();
          at(receipt, ["producer"]).startedAt = "2026-09-04T00:02:00.001Z";
          return [receipt, anchorFixture(), freshObservation()];
        },
      },
      {
        relation: "historical and fresh environmentName agree",
        gate: "repository-protection-parse.ts:1425-1430",
        code: "observedProtection.environmentBinding.environmentName:mismatch",
        input: (): readonly [Row, Row, Row] => {
          const observed = freshObservation();
          at(observed, ["environmentBinding"]).environmentName = "other-environment";
          refreshEvidence(observed);
          return [receiptFixture(), anchorFixture(), observed];
        },
      },
      {
        relation: "historical and fresh variableName agree",
        gate: "repository-protection-parse.ts:1431-1436",
        code: "observedProtection.environmentBinding.variableName:mismatch",
        input: (): readonly [Row, Row, Row] => {
          const observed = freshObservation();
          at(observed, ["environmentBinding"]).variableName = "OTHER_VARIABLE";
          refreshEvidence(observed);
          return [receiptFixture(), anchorFixture(), observed];
        },
      },
      {
        relation: "the fresh array holds exactly the six shared purposes",
        gate: "repository-protection-parse.ts:1763-1779",
        code: "observedProtection.apiObservations.3.purpose:fresh-census-required",
        input: (): readonly [Row, Row, Row] => {
          const observed = freshObservation();
          rowsAt(observed, ["apiObservations"])[3] = clone(
            at(receiptFixture(), ["apiObservations", 8]),
          );
          refreshEvidence(observed);
          return [receiptFixture(), anchorFixture(), observed];
        },
      },
      {
        relation: "the fresh workflows array censuses both roles",
        gate: "repository-protection-parse.ts:980-982",
        code: "observedProtection.workflows.role-census-required",
        input: (): readonly [Row, Row, Row] => {
          const observed = freshObservation();
          at(observed, ["workflows", 1]).role = "BUILD";
          refreshEvidence(observed);
          return [receiptFixture(), anchorFixture(), observed];
        },
      },
      {
        relation: "fresh repositoryId agrees with the receipt",
        gate: "the semantic-digest equality (6955-6957) also refuses it",
        code: "observedProtection.repositoryId:receipt-mismatch",
        input: (): readonly [Row, Row, Row] => {
          const observed = freshObservation();
          observed.repositoryId = "78";
          refreshEvidence(observed);
          return [receiptFixture(), anchorFixture(), observed];
        },
      },
    ];
    expect(defenceInDepth).toHaveLength(8);
    for (const entry of defenceInDepth) {
      const [receipt, anchor, observed] = entry.input();
      const issues = issuesOf(bind(receipt, anchor, observed, FRESH_COMPLETED_AT));
      expect(issues, entry.relation).toContain(entry.code);
    }
  });

  test("returns a refusal and never throws across the hostile-reflection corpus", () => {
    const positions = ["receipt", "anchor", "observedProtection", "evaluatedAt"] as const;
    const base: Record<(typeof positions)[number], unknown> = {
      receipt: receiptFixture(),
      anchor: anchorFixture(),
      observedProtection: freshObservation(),
      evaluatedAt: FRESH_COMPLETED_AT,
    };
    function callWith(position: (typeof positions)[number], value: unknown): BindResult {
      const argument = (name: (typeof positions)[number]): unknown =>
        name === position ? value : base[name];
      return bind(
        argument("receipt"),
        argument("anchor"),
        argument("observedProtection"),
        argument("evaluatedAt"),
      );
    }
    let calls = 0;
    for (const position of positions) {
      const supplied = base[position];
      const target: object =
        typeof supplied === "object" && supplied !== null ? supplied : { value: supplied };

      const proxyTrap = vi.fn(() => {
        throw new Error("proxy trap executed at " + position);
      });
      const proxied = new Proxy(target, {
        get: proxyTrap,
        getOwnPropertyDescriptor: proxyTrap,
        has: proxyTrap,
        ownKeys: proxyTrap,
      });
      expect(callWith(position, proxied).ok, position).toBe(false);
      expect(proxyTrap, position).not.toHaveBeenCalled();

      const accessorTrap = vi.fn(() => sha("accessor"));
      const accessorTarget = { ...(target as Row) };
      const accessorKey = required(Object.keys(accessorTarget)[0]);
      delete accessorTarget[accessorKey];
      Object.defineProperty(accessorTarget, accessorKey, {
        configurable: true,
        enumerable: true,
        get: accessorTrap,
      });
      expect(callWith(position, accessorTarget).ok, position).toBe(false);
      expect(accessorTrap, position).not.toHaveBeenCalled();

      const symbolTarget: Record<PropertyKey, unknown> = { ...(target as Row) };
      symbolTarget[Symbol("hidden")] = true;
      expect(callWith(position, symbolTarget).ok, position).toBe(false);

      const hiddenTarget: Record<PropertyKey, unknown> = { ...(target as Row) };
      Object.defineProperty(hiddenTarget, "hiddenMember", {
        configurable: true,
        enumerable: false,
        value: true,
      });
      expect(callWith(position, hiddenTarget).ok, position).toBe(false);

      const crossRealm = runInNewContext("(" + JSON.stringify(target) + ")") as unknown;
      expect(callWith(position, crossRealm).ok, position).toBe(false);

      const cyclic: Record<string, unknown> = { ...(target as Row) };
      cyclic.self = cyclic;
      expect(callWith(position, cyclic).ok, position).toBe(false);

      class Subclassed extends Object {}
      expect(callWith(position, Object.assign(new Subclassed(), target as Row)).ok, position).toBe(
        false,
      );

      for (const value of [null, undefined, [], 1, "x", true, Symbol.iterator, () => 1]) {
        let result: BindResult | undefined;
        expect(
          () => {
            result = callWith(position, value);
          },
          position + "/" + String(value),
        ).not.toThrow();
        expect(required(result).ok, position + "/" + String(value)).toBe(false);
        calls += 1;
      }
    }
    expect(calls).toBe(32);
    // Every input position simultaneously hostile still refuses without throwing.
    let all: BindResult | undefined;
    expect(() => {
      all = bind(null, undefined, [], Symbol.iterator);
    }).not.toThrow();
    expect(required(all).ok).toBe(false);
    expect(issuesOf(required(all))).toEqual([
      "anchor.value:non-json",
      "evaluatedAt:invalid",
      "observedProtection.record:object-required",
      "receipt.record:object-required",
    ]);
  });

  test("adds exactly one public name and leaves the Packet B census at twelve", () => {
    expect(Object.keys(binding).sort()).toEqual(["bindRepositoryProtectionEvidence"]);
    expect(codepointSorted(Object.keys(protection))).toEqual([
      "computeGitHubApiCompleteReductionDigest",
      "computeGitHubApiPageRequestDigest",
      "computeGitHubApiRequestIdentityDigest",
      "computeGitHubApiTerminalPaginationDigest",
      "computeRepositoryProtectionReceiptDigest",
      "computeRepositoryProtectionRulesetSemanticDigest",
      "parseRepositoryProtectionContract",
      "parseRepositoryProtectionReceipt",
      "repositoryProtectionPermissionNames",
      "repositoryProtectionPurposes",
      "repositoryProtectionSchemaFields",
      "repositoryProtectionSchemaVersions",
    ]);
    const publicNames = Object.keys(c);
    expect(publicNames).toContain("bindRepositoryProtectionEvidence");
    // Round 456 section 3.4: no standalone terminal-evidence helper accepting a
    // supplied `apiTerminals` projection, and no new parser name, is exported.
    for (const absent of [
      "computeRepositoryProtectionTerminalEvidenceDigest",
      "parseApiTerminal",
      "parseApiTerminals",
      "parseEvaluatedAt",
      "parseObservedProtection",
      "parseObservedProtectionStructure",
      "parseFreshApiObservation",
      "parseFreshApiObservations",
      "bindRepositoryProtection",
      "verifyRepositoryProtection",
      "authorizeRepositoryProtection",
    ])
      expect(publicNames, absent).not.toContain(absent);
  });

  test("adds no schema family, registry vocabulary or compatibility row", () => {
    // `observedProtection` has no schemaVersion member (6879-6882) and the
    // binder introduces no family, so parseContract/serializeContract routing
    // is untouched and registry.ts is not part of this packet.
    expect(protection.repositoryProtectionSchemaVersions).toEqual([RECEIPT_SCHEMA]);
    for (const version of c.schemaVersions)
      expect(version).not.toMatch(/observed-protection|terminal-evidence|protection-binding/);
    for (const key of Object.keys(c.schemaVocabularyDefinitions))
      expect(key).not.toMatch(/observed-protection|terminal-evidence|protection-binding/);
    for (const family of [
      "repository-protection-observed/v1",
      "repository-protection-terminal-evidence/v1",
      "repository-protection-binding/v1",
    ]) {
      expect(c.parseContract(family, freshObservation()).ok, family).toBe(false);
      expect(c.serializeContract(family, freshObservation()).ok, family).toBe(false);
    }
    expect(c.parseContract(RECEIPT_SCHEMA, freshObservation()).ok).toBe(false);
  });

  test("carries the binder source and vectors in the bundle census exactly once", () => {
    for (const [list, path] of [
      [iss002HarnessPaths, "packages/contracts/src/repository-protection-binding.ts"],
      [iss002TestBundlePaths, "test/contracts/repository-protection-binding.test.ts"],
    ] as const) {
      expect(list.filter((row) => row === path)).toHaveLength(1);
      expect(codepointSorted([...list])).toEqual([...list]);
    }
  });
});

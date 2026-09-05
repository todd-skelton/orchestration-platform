import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";
import * as c from "../../packages/contracts/src/index.js";
import * as protection from "../../packages/contracts/src/repository-protection.js";

const schema = "repository-protection-receipt/v1";
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const permissions = () =>
  protection.repositoryProtectionPermissionNames.map((permission) => ({
    access: permission === "id-token" ? "WRITE" : "NONE",
    permission,
  }));

type TestRecord = Record<string, unknown>;
type TestPage = TestRecord & {
  endCursor?: string | null;
  hasNextPage?: boolean;
  linkHeaderDigest?: string | null;
  linkRelations?: (TestRecord & { relation: string; targetRequestDigest: string })[];
  nextRequestDigest?: string | null;
  observedAt: string;
  ordinal: string;
  requestCursor?: string | null;
  requestDigest: string;
  responseDigest: string;
};
type TestWorkflow = TestRecord & {
  digest: string;
  path: string;
  permissions: (TestRecord & { access: string; permission: string })[];
  ref: string;
  role: string;
  trigger: TestRecord;
};
type TestObservation = TestRecord & {
  completeReductionDigest: string;
  pages: TestPage[];
  purpose: (typeof protection.repositoryProtectionPurposes)[number];
  reducedValueDigest: string;
  request: TestRecord;
  requestIdentityDigest: string;
  terminalPaginationDigest: string;
  triggeringBuild: TestRecord | null;
};
type TestReceipt = TestRecord & {
  apiObservations: TestObservation[];
  disposition: string;
  environmentBinding: TestRecord & {
    environmentName: string;
    variableName: string;
    variableUpdatedAt: string;
    variableValue: string;
  };
  expiresAt: string;
  issuedAt: string;
  producer: TestRecord & { runId: string; startedAt: string };
  protectedPathPolicies: TestRecord[];
  repositoryId: string;
  reviewPolicy: TestRecord;
  rulesetId: string;
  rulesetSemanticDigest: string;
  verifierAnchorDigest: string;
  workflows: TestWorkflow[];
};

function baseReceipt(): TestReceipt {
  const build = {
    digest: sha("build-workflow"),
    path: ".github/workflows/build.yml",
    permissionNamespace: "github-actions-permissions/2026-09-02",
    permissions: permissions(),
    ref: "refs/heads/main",
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
  const review = {
    digest: sha("review-workflow"),
    path: ".github/workflows/review.yml",
    permissionNamespace: "github-actions-permissions/2026-09-02",
    permissions: permissions(),
    ref: "refs/heads/main",
    role: "REVIEW",
    trigger: {
      activities: ["completed"],
      event: "WORKFLOW_RUN",
      requiredConclusion: "SUCCESS",
      sourceWorkflowDigest: build.digest,
      sourceWorkflowPath: build.path,
      sourceWorkflowRef: build.ref,
    },
    workflowId: "102",
  };
  return {
    apiObservations: [],
    disposition: "ACCEPTED",
    environmentBinding: {
      environmentEtag: '"environment-v1"',
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
      workflowDigest: review.digest,
      workflowPath: review.path,
      workflowRef: review.ref,
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
    schemaVersion: schema,
    verifierAnchorDigest: sha("anchor"),
    workflows: [build, review],
  };
}

function reducedProjection(
  receipt: TestReceipt,
  purpose: string,
  triggeringBuild: TestRecord | null,
): c.JsonValue | null {
  if (purpose === "ENVIRONMENT")
    return { environmentName: receipt.environmentBinding.environmentName };
  if (purpose === "ENVIRONMENT_VARIABLE")
    return {
      environmentName: receipt.environmentBinding.environmentName,
      variableName: receipt.environmentBinding.variableName,
      variableValue: receipt.environmentBinding.variableValue,
    };
  if (purpose === "REPOSITORY") return { repositoryId: receipt.repositoryId };
  if (purpose === "RULESET")
    return {
      protectedPathPolicies: receipt.protectedPathPolicies,
      reviewPolicy: receipt.reviewPolicy,
      rulesetId: receipt.rulesetId,
    } as unknown as c.JsonValue;
  if (purpose === "WORKFLOW_BUILD") return { workflow: receipt.workflows[0]! } as c.JsonValue;
  if (purpose === "WORKFLOW_REVIEW") return { workflow: receipt.workflows[1]! } as c.JsonValue;
  if (purpose === "WORKFLOW_RUN") return { triggeringBuild } as unknown as c.JsonValue;
  return null;
}

function restPages(requestIdentityDigest: string, purpose: string, count = 1) {
  const requestDigests = Array.from({ length: count }, (_, index) =>
    index === 0
      ? protection.computeGitHubApiPageRequestDigest(requestIdentityDigest, null)
      : sha(`${purpose}:opaque-rest-request:${index + 1}`),
  );
  return requestDigests.map((requestDigest, index) => {
    const final = index === count - 1;
    const linkRelations: { relation: string; targetRequestDigest: string }[] = [];
    if (index > 0)
      linkRelations.push({ relation: "FIRST", targetRequestDigest: requestDigests[0]! });
    if (!final)
      linkRelations.push({ relation: "LAST", targetRequestDigest: requestDigests[count - 1]! });
    if (!final)
      linkRelations.push({ relation: "NEXT", targetRequestDigest: requestDigests[index + 1]! });
    if (index > 0)
      linkRelations.push({ relation: "PREV", targetRequestDigest: requestDigests[index - 1]! });
    return {
      etag: `"${purpose}-${index + 1}"`,
      linkHeaderDigest: linkRelations.length ? sha(`${purpose}:link:${index + 1}`) : null,
      linkRelations,
      nextRequestDigest: final ? null : requestDigests[index + 1]!,
      observedAt: "2026-09-04T00:01:01.000Z",
      ordinal: String(index + 1),
      requestDigest,
      responseDigest: sha(`${purpose}:response:${index + 1}`),
      status: "200",
    };
  });
}

function graphqlPages(requestIdentityDigest: string, purpose: string, count = 1) {
  return Array.from({ length: count }, (_, index) => {
    const requestCursor = index === 0 ? null : `${purpose}-cursor-${index}`;
    return {
      endCursor:
        index === count - 1 ? `${purpose}-terminal-cursor` : `${purpose}-cursor-${index + 1}`,
      etag: index % 2 === 0 ? null : `"${purpose}-${index + 1}"`,
      hasNextPage: index !== count - 1,
      observedAt: "2026-09-04T00:01:01.000Z",
      ordinal: String(index + 1),
      requestCursor,
      requestDigest: protection.computeGitHubApiPageRequestDigest(
        requestIdentityDigest,
        requestCursor,
      ),
      responseDigest: sha(`${purpose}:response:${index + 1}`),
      status: "200",
    };
  });
}

function makeObservation(
  receipt: TestReceipt,
  purpose: (typeof protection.repositoryProtectionPurposes)[number],
  kind: "REST" | "GRAPHQL" = "REST",
  pageCount = 1,
): TestObservation {
  const request =
    kind === "REST"
      ? {
          apiKind: "REST",
          apiVersion: "2022-11-28",
          method: "GET",
          queryDigest: sha(`${purpose}:query`),
          route: `/repos/owner/repository/${purpose.toLowerCase()}`,
        }
      : {
          apiKind: "GRAPHQL",
          apiVersion: null,
          documentDigest: sha(`${purpose}:document`),
          method: "POST",
          variablesDigest: sha(`${purpose}:variables`),
        };
  const requestIdentityDigest = protection.computeGitHubApiRequestIdentityDigest(purpose, request);
  const pages =
    kind === "REST"
      ? restPages(requestIdentityDigest, purpose, pageCount)
      : graphqlPages(requestIdentityDigest, purpose, pageCount);
  const triggeringBuild =
    purpose === "WORKFLOW_RUN"
      ? {
          completedAt: "2026-09-04T00:00:59.999Z",
          conclusion: "SUCCESS",
          runAttempt: "1",
          runId: "9001",
          workflowDigest: receipt.workflows[0]!.digest,
          workflowPath: receipt.workflows[0]!.path,
          workflowRef: receipt.workflows[0]!.ref,
        }
      : null;
  const projection = reducedProjection(receipt, purpose, triggeringBuild);
  const reducedValueDigest = projection
    ? c.framedDigest("github-api-reduced-value/v1", [
        c.frame.text(purpose),
        c.frame.canonical(projection),
      ])
    : sha(`${purpose}:opaque-reduced-value`);
  const reductionPages = pages.map(({ ordinal, responseDigest }) => ({
    ordinal,
    responseDigest,
  }));
  return {
    completedAt: "2026-09-04T00:01:02.000Z",
    completeReductionDigest: protection.computeGitHubApiCompleteReductionDigest(
      requestIdentityDigest,
      reductionPages,
      reducedValueDigest,
    ),
    pages,
    purpose,
    reducedValueDigest,
    request,
    requestIdentityDigest,
    startedAt: "2026-09-04T00:01:00.000Z",
    terminalPaginationDigest: protection.computeGitHubApiTerminalPaginationDigest(
      requestIdentityDigest,
      kind,
      pages,
    ),
    triggeringBuild,
  };
}

function fixture() {
  const receipt = baseReceipt();
  receipt.rulesetSemanticDigest = protection.computeRepositoryProtectionRulesetSemanticDigest({
    protectedPathPolicies: receipt.protectedPathPolicies,
    repositoryId: receipt.repositoryId,
    reviewPolicy: receipt.reviewPolicy,
    rulesetId: receipt.rulesetId,
    workflows: receipt.workflows,
  });
  receipt.apiObservations = protection.repositoryProtectionPurposes.map((purpose, index) =>
    makeObservation(receipt, purpose, index === 3 ? "GRAPHQL" : "REST"),
  );
  return receipt;
}

type Path = readonly (string | number)[];
function at(root: unknown, path: Path): Record<string | number, unknown> {
  let value = root;
  for (const key of path) value = (value as Record<string | number, unknown>)[key];
  return value as Record<string | number, unknown>;
}
function changed(path: Path, value: unknown): TestReceipt {
  const receipt = fixture();
  at(receipt, path.slice(0, -1))[path[path.length - 1]!] = value;
  return receipt;
}
function refused(value: unknown) {
  expect(protection.parseRepositoryProtectionReceipt(value).ok).toBe(false);
  expect(c.parseContract(schema, value).ok).toBe(false);
  expect(c.serializeContract(schema, value).ok).toBe(false);
  expect(() => protection.computeRepositoryProtectionReceiptDigest(value)).toThrow(TypeError);
}
function freezeDeep(value: unknown, seal = false): void {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeDeep(child, seal);
    seal ? Object.seal(value) : Object.freeze(value);
  }
}
function refreshObservation(
  receipt: ReturnType<typeof fixture>,
  index: number,
  kind?: "REST" | "GRAPHQL",
  pageCount?: number,
): void {
  const purpose = protection.repositoryProtectionPurposes[index]!;
  receipt.apiObservations[index] = makeObservation(
    receipt,
    purpose,
    kind ?? (purpose === "PULL_REQUEST_REVIEWS" ? "GRAPHQL" : "REST"),
    pageCount,
  );
}

const recordPaths: Path[] = [
  [],
  ["reviewPolicy"],
  ["protectedPathPolicies", 0],
  ["protectedPathPolicies", 1],
  ["workflows", 0],
  ["workflows", 0, "permissions", 0],
  ["workflows", 0, "trigger"],
  ["workflows", 1],
  ["workflows", 1, "permissions", 16],
  ["workflows", 1, "trigger"],
  ["producer"],
  ["environmentBinding"],
  ["apiObservations", 0],
  ["apiObservations", 0, "request"],
  ["apiObservations", 0, "pages", 0],
  ["apiObservations", 3, "request"],
  ["apiObservations", 3, "pages", 0],
  ["apiObservations", 8, "triggeringBuild"],
];

describe("repository-protection historical receipt", () => {
  test("accepts all dispositions, recursively detaches, and freezes mutable, sealed, and frozen input", () => {
    for (const disposition of ["ACCEPTED", "REJECTED", "BLOCK_REPLAN"]) {
      for (const mode of ["mutable", "sealed", "frozen"]) {
        const input = fixture();
        input.disposition = disposition;
        if (mode !== "mutable") freezeDeep(input, mode === "sealed");
        const parsed = protection.parseRepositoryProtectionReceipt(input);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) throw new Error(parsed.issues.join(","));
        expect(parsed.value).toEqual(input);
        expect(parsed.value).not.toBe(input);
        expect(parsed.value.apiObservations).not.toBe(input.apiObservations);
        expect(Object.isFrozen(parsed.value)).toBe(true);
        expect(Object.isFrozen(parsed.value.apiObservations)).toBe(true);
        expect(Object.isFrozen(parsed.value.apiObservations[0])).toBe(true);
        if (mode === "mutable") {
          input.environmentBinding.variableValue = sha("moved");
          input.apiObservations[0]!.pages[0]!.etag = '"moved"';
          expect(parsed.value.environmentBinding.variableValue).toBe(sha("anchor"));
          expect(
            (parsed.value.apiObservations[0]!.pages as readonly Record<string, unknown>[])[0]!.etag,
          ).toBe('"ENVIRONMENT-1"');
        }
      }
    }
  });

  test("closes every record before semantics and refuses omitted, null, renamed, and extra fields", () => {
    for (const path of recordPaths) {
      for (const field of Object.keys(at(fixture(), path))) {
        const omitted = fixture();
        delete at(omitted, path)[field];
        refused(omitted);
        if (at(fixture(), path)[field] !== null) refused(changed([...path, field], null));
        const renamed = fixture();
        const row = at(renamed, path);
        row[`${field}Other`] = row[field];
        delete row[field];
        refused(renamed);
      }
      const extra = fixture();
      at(extra, path).future = true;
      refused(extra);
    }
    for (const value of [undefined, null, [], true, 1, "receipt", new Date()]) refused(value);
  });

  test("publishes the complete schema, registry, compatibility, generic serialization, and export surface", () => {
    const f = fixture();
    const rows: Record<string, unknown> = {
      receipt: f,
      reviewPolicy: f.reviewPolicy,
      protectedPathPolicy: f.protectedPathPolicies[0],
      workflow: f.workflows[0],
      permission: f.workflows[0]!.permissions[0],
      trigger: f.workflows[0]!.trigger,
      observation: f.apiObservations[0],
      restRequest: f.apiObservations[0]!.request,
      graphqlRequest: f.apiObservations[3]!.request,
      restPage: f.apiObservations[0]!.pages[0],
      graphqlPage: f.apiObservations[3]!.pages[0],
      triggeringBuild: f.apiObservations[8]!.triggeringBuild,
      producer: f.producer,
      environmentBinding: f.environmentBinding,
    };
    for (const [name, row] of Object.entries(rows))
      expect(
        protection.repositoryProtectionSchemaFields[
          name as keyof typeof protection.repositoryProtectionSchemaFields
        ],
      ).toEqual(Object.keys(row as object).sort());
    expect(c.schemaVersions.filter((value) => value === schema)).toHaveLength(1);
    expect(c.compatibilityDisposition(schema, schema)).toBe("readable");
    for (const observed of [
      null,
      "repository-protection-receipt/v0",
      "repository-protection-receipt/v2",
      "bootstrap-verifier-anchor/v1",
    ])
      expect(c.compatibilityDisposition(schema, observed)).toBe("refused");
    expect(protection.parseRepositoryProtectionContract("unknown/v1", f)).toBeNull();
    const generic = c.parseContract(schema, f);
    expect(generic.ok).toBe(true);
    const serialized = c.serializeContract(schema, f);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) throw new Error(serialized.issues.join(","));
    expect(serialized.bytes).toEqual(c.canonicalBytes(f));
    expect(serialized.digest).toBe(protection.computeRepositoryProtectionReceiptDigest(f));
    expect(c.parseCanonicalContractBytes(schema, serialized.bytes)).toEqual(generic);
    for (const [name, value] of Object.entries(protection))
      expect((c as Record<string, unknown>)[name]).toBe(value);
  });

  test("pins scalar, literal, ref, route, UTF-8, identity, and expiry boundaries", () => {
    for (const [path, values] of [
      [["repositoryId"], ["0", "01", "9007199254740992", 1, "1\n"]],
      [["rulesetId"], ["0", "01", "9007199254740992", 1, "1\n"]],
      [
        ["producer", "runId"],
        ["0", "01", "9007199254740992", 1, "1\n"],
      ],
      [
        ["producer", "runAttempt"],
        ["0", "01", "9007199254740992", 1, "1\n"],
      ],
    ] as [Path, unknown[]][])
      for (const value of values) refused(changed(path, value));
    for (const disposition of ["accepted", "UNKNOWN", "", null])
      refused(changed(["disposition"], disposition));
    for (const name of ["", ".", "..", "a/b", "a\\b", "a\n", "é".repeat(129)])
      refused(changed(["producer", "artifactName"], name));
    for (const value of [
      "main",
      "refs/tags/main",
      "refs/heads/",
      "refs/heads/a..b",
      "refs/heads/a.lock",
      "refs/heads/a b",
      "refs/heads/a\\b",
      "refs/heads/" + "é".repeat(251),
    ])
      refused(changed(["workflows", 0, "ref"], value));
    for (const value of ["", "/absolute", "a\\b", "a/../b", "a\n", "é".repeat(257)])
      refused(changed(["protectedPathPolicies", 0, "path"], value));
    for (const value of [
      "repos/x",
      "/repos/x?q=1",
      "/repos/x#f",
      "/repos/x\n",
      "/" + "é".repeat(256),
    ])
      refused(changed(["apiObservations", 0, "request", "route"], value));
    for (const value of ["", "with space", "x\n", "é".repeat(513)])
      refused(changed(["apiObservations", 0, "pages", 0, "etag"], value));
    for (const [expiresAt, accepted] of [
      ["2026-09-04T00:02:00.001Z", true],
      ["2026-09-11T00:02:00.000Z", true],
      ["2026-09-04T00:02:00.000Z", false],
      ["2026-09-04T00:01:59.999Z", false],
      ["2026-09-11T00:02:00.001Z", false],
    ] as const)
      expect(
        protection.parseRepositoryProtectionReceipt(changed(["expiresAt"], expiresAt)).ok,
      ).toBe(accepted);
  });

  test("pins policy, protected paths, permission census and BUILD-to-REVIEW trigger identity", () => {
    for (const [path, value] of [
      [["reviewPolicy", "adminBypass"], "ALLOWED"],
      [["reviewPolicy", "authorApproval"], "REQUIRED"],
      [["reviewPolicy", "minimumApprovals"], "2"],
      [["protectedPathPolicies", 0, "reviewPolicy"], "GLOB"],
      [["workflows", 0, "permissionNamespace"], "github-actions-permissions/latest"],
      [["workflows", 0, "permissions", 8, "access"], "READ"],
      [["workflows", 0, "permissions", 10, "access"], "WRITE"],
      [["workflows", 0, "trigger", "event"], "WORKFLOW_RUN"],
      [["workflows", 0, "trigger", "requiredConclusion"], "SUCCESS"],
      [["workflows", 1, "trigger", "requiredConclusion"], "FAILURE"],
      [["workflows", 1, "trigger", "sourceWorkflowPath"], ".github/workflows/other.yml"],
      [["producer", "workflowPath"], ".github/workflows/build.yml"],
    ] as [Path, unknown][])
      refused(changed(path, value));
    for (const path of [["protectedPathPolicies"], ["workflows"]] as Path[]) {
      const f = fixture();
      const rows = at(f, path) as unknown as unknown[];
      refused(changed(path, [...rows].reverse()));
      refused(changed(path, [rows[0], rows[0]]));
    }
    for (const workflowIndex of [0, 1]) {
      const rows = fixture().workflows[workflowIndex]!.permissions;
      refused(changed(["workflows", workflowIndex, "permissions"], rows.slice(0, 16)));
      refused(changed(["workflows", workflowIndex, "permissions"], [...rows, rows[0]]));
      const swapped = [...rows];
      [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
      refused(changed(["workflows", workflowIndex, "permissions"], swapped));
    }
  });

  test("binds nine purpose rows, recomputed reductions, producer chronology, and distinct successful BUILD source", () => {
    const reversed = fixture();
    reversed.apiObservations.reverse();
    refused(reversed);
    refused(changed(["apiObservations", 1, "purpose"], "ENVIRONMENT"));
    refused(changed(["apiObservations", 0, "requestIdentityDigest"], sha("other")));
    refused(changed(["apiObservations", 0, "reducedValueDigest"], sha("other")));
    refused(changed(["apiObservations", 8, "triggeringBuild"], null));
    refused(
      changed(
        ["apiObservations", 0, "triggeringBuild"],
        fixture().apiObservations[8]!.triggeringBuild,
      ),
    );
    refused(changed(["apiObservations", 8, "triggeringBuild", "conclusion"], "FAILURE"));
    refused(changed(["apiObservations", 8, "triggeringBuild", "runId"], "9002"));
    refused(
      changed(["apiObservations", 8, "triggeringBuild", "completedAt"], "2026-09-04T00:01:00.001Z"),
    );
    refused(changed(["environmentBinding", "variableUpdatedAt"], "2026-09-04T00:01:00.000Z"));
    refused(changed(["producer", "startedAt"], "2026-09-04T00:02:00.001Z"));
    refused(changed(["apiObservations", 0, "startedAt"], "2026-09-03T23:59:59.999Z"));
    refused(changed(["apiObservations", 0, "pages", 0, "observedAt"], "2026-09-04T00:01:02.001Z"));
    refused(changed(["apiObservations", 0, "completedAt"], "2026-09-04T00:02:00.001Z"));
    const opaque = fixture();
    opaque.apiObservations[2]!.reducedValueDigest = sha("different opaque pull request reduction");
    opaque.apiObservations[2]!.completeReductionDigest =
      protection.computeGitHubApiCompleteReductionDigest(
        opaque.apiObservations[2]!.requestIdentityDigest,
        opaque.apiObservations[2]!.pages.map(({ ordinal, responseDigest }) => ({
          ordinal,
          responseDigest,
        })),
        opaque.apiObservations[2]!.reducedValueDigest,
      );
    expect(protection.parseRepositoryProtectionReceipt(opaque).ok).toBe(true);
  });

  test("enforces REST chains at 1, 2, and 64 pages and refuses every terminal/link boundary", () => {
    for (const count of [1, 2, 64]) {
      const f = fixture();
      refreshObservation(f, 0, "REST", count);
      expect(protection.parseRepositoryProtectionReceipt(f).ok).toBe(true);
    }
    for (const count of [0, 65]) {
      const f = fixture();
      refreshObservation(f, 0, "REST", Math.max(1, Math.min(64, count)));
      f.apiObservations[0]!.pages =
        count === 0 ? [] : [...f.apiObservations[0]!.pages, f.apiObservations[0]!.pages[63]!];
      refused(f);
    }
    const mutations: ((f: ReturnType<typeof fixture>) => void)[] = [
      (f) =>
        f.apiObservations[0]!.pages[0]!.linkRelations!.push({
          relation: "NEXT",
          targetRequestDigest: f.apiObservations[0]!.pages[1]!.requestDigest,
        }),
      (f) =>
        f.apiObservations[0]!.pages[0]!.linkRelations!.push({
          relation: "FIRST",
          targetRequestDigest: f.apiObservations[0]!.pages[0]!.requestDigest,
        }),
      (f) => {
        f.apiObservations[0]!.pages[0]!.linkRelations![1]!.targetRequestDigest = sha("skipped");
      },
      (f) => {
        f.apiObservations[0]!.pages[0]!.nextRequestDigest = sha("disagrees");
      },
      (f) => {
        f.apiObservations[0]!.pages[1]!.requestDigest =
          f.apiObservations[0]!.pages[0]!.requestDigest;
      },
      (f) => {
        f.apiObservations[0]!.pages[1]!.nextRequestDigest =
          f.apiObservations[0]!.pages[0]!.requestDigest;
      },
      (f) => {
        f.apiObservations[0]!.pages[1]!.linkHeaderDigest = null;
      },
      (f) => {
        f.apiObservations[0]!.pages[1]!.nextRequestDigest = sha("nonterminal-final");
      },
      (f) => {
        f.apiObservations[0]!.pages[0]!.linkRelations!.reverse();
      },
      (f) => {
        f.apiObservations[0]!.pages[0]!.ordinal = "2";
      },
    ];
    for (const mutate of mutations) {
      const f = fixture();
      refreshObservation(f, 0, "REST", 2);
      mutate(f);
      refused(f);
    }
    const one = fixture();
    one.apiObservations[0]!.pages[0]!.linkRelations!.push({
      relation: "LAST",
      targetRequestDigest: one.apiObservations[0]!.pages[0]!.requestDigest,
    });
    refused(one);
  });

  test("enforces GraphQL cursor and request identities at 1, 2, and 64 pages", () => {
    for (const count of [1, 2, 64]) {
      const f = fixture();
      refreshObservation(f, 3, "GRAPHQL", count);
      expect(protection.parseRepositoryProtectionReceipt(f).ok).toBe(true);
    }
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => {
        f.apiObservations[3]!.pages[0]!.requestCursor = "invented";
      },
      (f: ReturnType<typeof fixture>) => {
        f.apiObservations[3]!.pages[0]!.hasNextPage = false;
      },
      (f: ReturnType<typeof fixture>) => {
        f.apiObservations[3]!.pages[0]!.endCursor = null;
      },
      (f: ReturnType<typeof fixture>) => {
        f.apiObservations[3]!.pages[1]!.requestCursor = "wrong";
      },
      (f: ReturnType<typeof fixture>) => {
        f.apiObservations[3]!.pages[1]!.hasNextPage = true;
      },
      (f: ReturnType<typeof fixture>) => {
        f.apiObservations[3]!.pages[1]!.requestDigest = sha("caller-count");
      },
    ]) {
      const f = fixture();
      refreshObservation(f, 3, "GRAPHQL", 2);
      mutate(f);
      refused(f);
    }
    for (const count of [0, 65]) {
      const f = fixture();
      refreshObservation(f, 3, "GRAPHQL", count === 0 ? 1 : 64);
      f.apiObservations[3]!.pages =
        count === 0 ? [] : [...f.apiObservations[3]!.pages, f.apiObservations[3]!.pages[63]!];
      refused(f);
    }
  });

  test("treats opaque leaves as claims while every enclosing recomputable digest moves", () => {
    const f = fixture();
    const row = f.apiObservations[0]!;
    const originalRequest = row.requestIdentityDigest;
    row.request.queryDigest = sha("changed opaque query bytes");
    const nextRequest = protection.computeGitHubApiRequestIdentityDigest(row.purpose, row.request);
    expect(nextRequest).not.toBe(originalRequest);
    const firstPage = protection.computeGitHubApiPageRequestDigest(nextRequest, null);
    expect(firstPage).not.toBe(row.pages[0]!.requestDigest);
    row.requestIdentityDigest = nextRequest;
    row.pages[0]!.requestDigest = firstPage;
    row.pages[0]!.responseDigest = sha("changed opaque body bytes");
    row.completeReductionDigest = protection.computeGitHubApiCompleteReductionDigest(
      nextRequest,
      row.pages.map(({ ordinal, responseDigest }) => ({ ordinal, responseDigest })),
      row.reducedValueDigest,
    );
    row.terminalPaginationDigest = protection.computeGitHubApiTerminalPaginationDigest(
      nextRequest,
      "REST",
      row.pages,
    );
    expect(protection.parseRepositoryProtectionReceipt(f).ok).toBe(true);
    expect(protection.computeRepositoryProtectionReceiptDigest(f)).not.toBe(
      protection.computeRepositoryProtectionReceiptDigest(fixture()),
    );
  });

  test("pins independently calculated canonical and framed digest goldens", () => {
    const f = fixture();
    const row = f.apiObservations[0]!;
    expect(c.canonicalJson(row.request)).toBe(
      '{"apiKind":"REST","apiVersion":"2022-11-28","method":"GET","queryDigest":"748728053759d33c07be4fa603f064a27b414ca4cfd2aa8eb00bfc226c245559","route":"/repos/owner/repository/environment"}\n',
    );
    expect(row.requestIdentityDigest).toBe(
      "8138f1981c4216367b5a01575fda23813283fcb6bb7294cfbdc40d6b2f522906",
    );
    expect(row.pages[0]!.requestDigest).toBe(
      "92d8cecd678bd2062ac8df356a51b036044849e859d94fd6a3c80136c409dc0c",
    );
    expect(row.completeReductionDigest).toBe(
      "eb752c9b35d565804ef2c927cf58942e1135d71b108fa506d687a2d76787f93d",
    );
    expect(row.terminalPaginationDigest).toBe(
      "f8e4922d097117668c22e8870ac726bac6870232c57f1c8e0c1d0c191db4b55a",
    );
    expect(f.apiObservations[3]!.terminalPaginationDigest).toBe(
      "065fdb557d59c2d1dfd9185e1524ad39f331419727e13055fb9a945c33d970b8",
    );
    expect(f.rulesetSemanticDigest).toBe(
      "ddef4024cf3ad45f96c479c02f1a6e3c352ff34fad10bc79572c358c367cc42d",
    );
    expect(protection.computeRepositoryProtectionReceiptDigest(f)).toBe(
      "2ab8c816a39da770a5a7c31ff66420f54b69eab21ace33ccf33815c4452cc9fa",
    );
    expect(protection.computeGitHubApiRequestIdentityDigest(row.purpose, { ...row.request })).toBe(
      row.requestIdentityDigest,
    );
    expect(() =>
      protection.computeGitHubApiPageRequestDigest(row.requestIdentityDigest, "x\n"),
    ).toThrow(TypeError);
    expect(() =>
      protection.computeGitHubApiCompleteReductionDigest(
        row.requestIdentityDigest,
        [],
        row.reducedValueDigest,
      ),
    ).toThrow(TypeError);
    expect(() =>
      protection.computeGitHubApiTerminalPaginationDigest(row.requestIdentityDigest, "REST", []),
    ).toThrow(TypeError);
  });

  test("refuses hostile reflection without invoking traps and rejects noncanonical bytes", () => {
    const proxyTrap = vi.fn(() => {
      throw new Error("trap invoked");
    });
    refused(new Proxy(fixture(), { ownKeys: proxyTrap }));
    expect(proxyTrap).not.toHaveBeenCalled();
    const request = fixture().apiObservations[0]!.request;
    const requestProxyTrap = vi.fn(() => {
      throw new Error("request trap invoked");
    });
    expect(() =>
      protection.computeGitHubApiRequestIdentityDigest(
        "ENVIRONMENT",
        new Proxy(request, { get: requestProxyTrap, ownKeys: requestProxyTrap }),
      ),
    ).toThrow(TypeError);
    expect(requestProxyTrap).not.toHaveBeenCalled();
    const requestWithAccessor = Object.fromEntries(
      Object.entries(request).filter(([key]) => key !== "apiKind"),
    );
    const apiKindGetter = vi.fn(() => "REST");
    Object.defineProperty(requestWithAccessor, "apiKind", {
      enumerable: true,
      get: apiKindGetter,
    });
    expect(() =>
      protection.computeGitHubApiRequestIdentityDigest("ENVIRONMENT", requestWithAccessor),
    ).toThrow(TypeError);
    expect(apiKindGetter).not.toHaveBeenCalled();
    for (const path of [
      [],
      ["apiObservations"],
      ["apiObservations", 0, "pages"],
      ["workflows"],
      ["workflows", 0, "permissions"],
    ] as Path[]) {
      const sparse = fixture();
      const rows = at(sparse, path) as unknown as unknown[];
      if (Array.isArray(rows)) delete rows[0];
      else Object.defineProperty(rows, "hidden", { value: true, enumerable: false });
      refused(sparse);
    }
    const accessor = fixture();
    const getter = vi.fn(() => sha("trap"));
    Object.defineProperty(accessor, "verifierAnchorDigest", { enumerable: true, get: getter });
    refused(accessor);
    expect(getter).not.toHaveBeenCalled();
    const symbol = fixture() as Record<PropertyKey, unknown>;
    symbol[Symbol("hidden")] = true;
    refused(symbol);
    const crossRealm = runInNewContext(`(${JSON.stringify(fixture())})`) as unknown;
    refused(crossRealm);
    class Receipt extends Object {}
    refused(Object.assign(new Receipt(), fixture()));
    const cyclic = fixture();
    (cyclic as Record<string, unknown>).self = cyclic;
    refused(cyclic);
    const canonical = c.canonicalBytes(fixture());
    for (const text of [
      new TextDecoder().decode(canonical).replace(/\n$/, ""),
      ` ${new TextDecoder().decode(canonical)}`,
      new TextDecoder()
        .decode(canonical)
        .replace(
          '"apiObservations"',
          '"schemaVersion":"repository-protection-receipt/v1","apiObservations"',
        ),
    ])
      expect(c.parseCanonicalContractBytes(schema, new TextEncoder().encode(text)).ok).toBe(false);
  });
});

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { canonicalBytes } from "../../packages/contracts/src/index.js";
import * as decision from "../../packages/conformance/src/portable-primitives-decision.js";
import * as provider from "../../packages/conformance/src/github-portable-primitives-review.js";
import { readGithubHostedPortablePrimitivesReview } from "../../scripts/conformance/hosted-review-api.mjs";
import { loadHostedStableInputs } from "../../scripts/conformance/hosted-observation.mjs";
import { writeHostedPortablePrimitivesReview } from "../../scripts/conformance/hosted-terminal.mjs";
import {
  iss002HarnessPaths,
  iss002TestBundlePaths,
} from "../../packages/conformance/src/stable-bundles.js";
import type { GithubFetch } from "../../scripts/conformance/hosted-record-api.mjs";

const digest = (value: string) => value.repeat(64);
const head = "a".repeat(40);
const merge = "b".repeat(40);
const main = "c".repeat(40);
const root = "/repos/example/portable-platform";
const prPath = `${root}/pulls/19`;
const reviewsPath = `${prPath}/reviews?per_page=100&page=1`;
const filesPath = `${prPath}/files?per_page=100&page=1`;
const protectionPath = `${root}/branches/main/protection`;
const rulesetsPath = `${root}/rulesets?includes_parents=true&per_page=100&page=1`;
const stable = decision.computePortablePrimitivesStableHarnessSubjectDigest(
  digest("3"),
  digest("4"),
  digest("5"),
  digest("6"),
);
const core = {
  aggregateDigest: null,
  candidateSubjectDigest: digest("1"),
  contractVersionsDigest: digest("6"),
  custodyProfileDigest: "d01b36552a70cdb11cd1e8baf9df096c515158ca0dd3019176c2c83b6d7eb33d",
  decision: "BLOCK_REPLAN",
  decisionWriterDigest: decision.computePortablePrimitivesDecisionWriterDigest(
    stable,
    digest("3"),
    digest("4"),
    digest("6"),
  ),
  diagnosticTerminalDigest: digest("7"),
  harnessBundleDigest: digest("3"),
  helperAbiDigests: [null, null, null],
  helperDigests: [null, null, null],
  observationDigests: [],
  osProfileDigests: [null, null, null],
  profile: Object.fromEntries(
    Object.keys(decision.portablePrimitivesCapabilityProfile).map((key) => [key, null]),
  ),
  providerRunDigest: digest("2"),
  requiredJobRegistryDigest: digest("5"),
  schemaVersion: decision.portablePrimitivesDecisionCoreSchemaVersion,
  stableHarnessSubjectDigest: stable,
  testBundleDigest: digest("4"),
};
const coreDigest = decision.computePortablePrimitivesCapabilityDecisionCoreDigest(core);
const expected = {
  repositoryId: "123",
  pullRequestNumber: "19",
  decisionCoreDigest: coreDigest,
  mergeCommitRevision: merge,
};
const review = {
  id: 81,
  user: { id: 42 },
  state: "APPROVED",
  commit_id: head,
  submitted_at: "2026-08-30T11:00:00Z",
  pull_request_url: `https://api.github.com${prPath}`,
};
const treeSha = (index: number) => String(index + 1).padStart(40, "0");
const treePath = (index: number) => `${root}/git/trees/${treeSha(index)}`;
const object = (value: unknown) => value as Record<string, unknown>;

function fixture(bytes: Uint8Array = canonicalBytes(core), reviewExpected = expected) {
  const corePath = `planning/decisions/ISS-022/${reviewExpected.decisionCoreDigest}/decision-core.json`;
  const blobSha = createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
  const routes = new Map<string, unknown>([
    [
      "/repositories/123",
      { id: 123, full_name: "example/portable-platform", permissions: { admin: true } },
    ],
    [
      protectionPath,
      {
        enforce_admins: { enabled: true },
        allow_deletions: { enabled: false },
        allow_force_pushes: { enabled: false },
        required_pull_request_reviews: {},
      },
    ],
    [rulesetsPath, []],
    [
      prPath,
      {
        number: 19,
        state: "closed",
        merged: true,
        draft: false,
        merge_commit_sha: merge,
        changed_files: 1,
        merged_at: "2026-08-30T12:00:00Z",
        user: { id: 41 },
        base: { ref: "main", repo: { id: 123 } },
        head: { sha: head, repo: { id: 123 } },
      },
    ],
    [filesPath, [{ filename: corePath, status: "added", sha: blobSha }]],
    [reviewsPath, [review]],
    [`${root}/git/commits/${head}`, { sha: head, tree: { sha: treeSha(0) } }],
    [`${root}/git/commits/${merge}`, { sha: merge, tree: { sha: treeSha(0) } }],
    [
      `${root}/git/blobs/${blobSha}`,
      {
        sha: blobSha,
        encoding: "base64",
        size: bytes.byteLength,
        content: Buffer.from(bytes).toString("base64"),
      },
    ],
    [`${root}/branches/main`, { name: "main", protected: true, commit: { sha: main } }],
    [
      `${root}/compare/${merge}...${main}`,
      { status: "ahead", base_commit: { sha: merge }, merge_base_commit: { sha: merge } },
    ],
  ]);
  corePath.split("/").forEach((part, index, parts) => {
    const leaf = index === parts.length - 1;
    routes.set(treePath(index), {
      sha: treeSha(index),
      truncated: false,
      tree: [
        {
          path: part,
          mode: leaf ? "100644" : "040000",
          type: leaf ? "blob" : "tree",
          sha: leaf ? blobSha : treeSha(index + 1),
        },
      ],
    });
  });
  const requests: string[] = [];
  const counts = new Map<string, number>();
  const headers = new Map<string, Record<string, string>>();
  const row = (path: string) => object(routes.get(path));
  const rows = (path: string) => routes.get(path) as Record<string, unknown>[];
  let change: ((path: string, value: unknown, count: number) => unknown) | undefined;
  const fetcher: GithubFetch = async (url, init) => {
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("error");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer fixture-token");
    const path = url.slice("https://api.github.com".length);
    requests.push(path);
    const count = (counts.get(path) ?? 0) + 1;
    counts.set(path, count);
    if (!routes.has(path)) throw new Error("unexpected fixture request");
    const value = change
      ? await change(path, structuredClone(routes.get(path)), count)
      : routes.get(path);
    if (value instanceof Response) return value;
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { date: "Sun, 30 Aug 2026 12:01:00 GMT", ...headers.get(path) },
    });
  };
  const run = (
    overrides: Partial<Parameters<typeof readGithubHostedPortablePrimitivesReview>[0]> = {},
  ) =>
    readGithubHostedPortablePrimitivesReview({
      expected: reviewExpected,
      token: "fixture-token",
      fetcher,
      ...overrides,
    });
  return {
    blobSha,
    routes,
    requests,
    headers,
    row,
    rows,
    run,
    fetcher,
    mutate: (callback: NonNullable<typeof change>) => {
      change = callback;
    },
  };
}

describe("authenticated portable primitives review projection", () => {
  test("projects the exact reviewed core using only the four review arguments and authentication", async () => {
    const f = fixture();
    const result = await f.run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const projected = result.value.providerReview;
    expect(projected).toMatchObject({
      repositoryId: "123",
      pullRequestNumber: "19",
      reviewId: "81",
      reviewerId: "42",
      corePullRequestAuthorId: "41",
      reviewCommitRevision: head,
      mergeCommitRevision: merge,
      decisionCoreDigest: coreDigest,
    });
    expect(result.value.coreBytes).toEqual(canonicalBytes(core));
    expect(projected.candidateSubjectDigest).toBe(result.value.core.candidateSubjectDigest);
    expect(projected.providerRunDigest).toBe(result.value.core.providerRunDigest);
    expect(
      provider.joinGithubPortablePrimitivesIndependentReviewRecords(
        projected,
        result.value.core,
        {
          decisionCoreDigest: coreDigest,
          providerReviewDigest: result.value.digest,
          reviewDisposition: "RECORD_BLOCK_REPLAN",
          reviewedAt: projected.reviewedAt,
          reviewerSubjectDigest: provider.computeGithubReviewerSubjectDigest("123", "42"),
          schemaVersion: decision.portablePrimitivesIndependentReviewSchemaVersion,
        },
        result.value.coreBytes,
      ).ok,
    ).toBe(true);
    expect(f.requests.filter((path) => path === reviewsPath)).toHaveLength(2);
    expect(f.requests.filter((path) => path === protectionPath)).toHaveLength(2);
  });

  test.each([
    ["repository mismatch", "/repositories/123", "id", 124],
    ["non-admin", "/repositories/123", "permissions", { admin: false }],
    ["missing admin", "/repositories/123", "permissions", {}],
    ["wrong PR", prPath, "number", 20],
    ["unmerged PR", prPath, "merged", false],
    ["open PR", prPath, "state", "open"],
    ["draft PR", prPath, "draft", true],
    ["wrong merge", prPath, "merge_commit_sha", head],
    ["extra files", prPath, "changed_files", 2],
    ["wrong base", prPath, "base", { ref: "other", repo: { id: 123 } }],
    ["foreign base", prPath, "base", { ref: "main", repo: { id: 124 } }],
    ["wrong head", prPath, "head", { sha: main, repo: { id: 123 } }],
    ["future merge", prPath, "merged_at", "2026-08-30T12:02:00Z"],
    ["malformed merge time", prPath, "merged_at", "2026-02-30T12:00:00Z"],
    ["unprotected main", `${root}/branches/main`, "protected", false],
    ["merge off main", `${root}/compare/${merge}...${main}`, "status", "diverged"],
    ["wrong ancestry", `${root}/compare/${merge}...${main}`, "merge_base_commit", { sha: head }],
    ["truncated tree", treePath(0), "truncated", true],
  ])("refuses %s", async (_label, path, key, value) => {
    const f = fixture();
    f.row(String(path))[String(key)] = value;
    expect((await f.run()).ok).toBe(false);
  });

  test.each([
    { user: { id: 41 } },
    { commit_id: merge },
    { state: "DISMISSED" },
    { state: "CHANGES_REQUESTED" },
    { state: "PENDING" },
    { state: "OTHER" },
    { submitted_at: "2026-08-30T12:00:01Z" },
    { submitted_at: "2026-08-30" },
    { id: 0 },
    { id: Number.MAX_SAFE_INTEGER + 1 },
    { user: { id: null } },
    { pull_request_url: "https://api.github.com/repos/other/repo/pulls/19" },
  ])("refuses stale, self, malformed, or unapproved review %j", async (mutant) => {
    const f = fixture();
    f.routes.set(reviewsPath, [{ ...review, ...mutant }]);
    expect((await f.run()).ok).toBe(false);
  });

  test("rejects superseded approvals and duplicate IDs without rejecting an unrelated comment", async () => {
    for (const state of ["CHANGES_REQUESTED", "DISMISSED", "COMMENTED", "PENDING"]) {
      const f = fixture();
      f.routes.set(reviewsPath, [review, { ...review, id: 82, state }]);
      expect((await f.run()).ok).toBe(false);
    }
    const duplicate = fixture();
    duplicate.routes.set(reviewsPath, [review, review]);
    expect((await duplicate.run()).ok).toBe(false);
    const unrelated = fixture();
    unrelated.routes.set(reviewsPath, [
      review,
      { ...review, id: 82, user: { id: 43 }, state: "COMMENTED" },
    ]);
    expect((await unrelated.run()).ok).toBe(true);
  });

  test("requires exact file path, added status, ordinary tree mode, canonical bytes and digest", async () => {
    for (const mutant of [
      { filename: "alternate.json" },
      { status: "modified" },
      { status: "renamed" },
      { sha: head },
    ]) {
      const f = fixture();
      Object.assign(f.rows(filesPath)[0]!, mutant);
      expect((await f.run()).ok).toBe(false);
    }
    for (const mode of ["120000", "100755", "160000"]) {
      const f = fixture();
      object((f.row(treePath(4)).tree as unknown[])[0]).mode = mode;
      expect((await f.run()).ok).toBe(false);
    }
    for (const bytes of [
      new TextEncoder().encode(`${JSON.stringify(core)}\n`),
      canonicalBytes({ ...core, candidateSubjectDigest: digest("8") }),
      canonicalBytes({ ...core, providerRunDigest: digest("8") }),
      new Uint8Array([255]),
    ]) {
      expect((await fixture(bytes).run()).ok).toBe(false);
    }
    const blob = fixture();
    blob.row(`${root}/git/blobs/${blob.blobSha}`).content =
      Buffer.from("substituted").toString("base64");
    expect((await blob.run()).ok).toBe(false);
    const merged = fixture();
    merged.row(`${root}/git/commits/${merge}`).tree = { sha: main };
    expect((await merged.run()).ok).toBe(false);
  });

  test("refuses invalid arguments before reads", async () => {
    for (const override of [
      { token: "" },
      { expected: { ...expected, repositoryId: "0123" } },
      { expected: { ...expected, pullRequestNumber: "19/../../other" } },
      { expected: { ...expected, decisionCoreDigest: "invalid" } },
    ]) {
      const f = fixture();
      expect((await f.run(override)).ok).toBe(false);
      expect(f.requests).toEqual([]);
    }
  });

  test("refuses live protection gaps, bypass and incomplete rulesets", async () => {
    for (const key of ["enforce_admins", "allow_force_pushes", "allow_deletions"]) {
      const f = fixture();
      f.row(protectionPath)[key] = { enabled: key !== "enforce_admins" };
      expect((await f.run()).ok).toBe(false);
    }
    const bypass = fixture();
    bypass.row(protectionPath).required_pull_request_reviews = {
      bypass_pull_request_allowances: { apps: [], teams: [], users: [{ id: 42 }] },
    };
    expect((await bypass.run()).ok).toBe(false);
    const missing = fixture();
    missing.row(protectionPath).required_pull_request_reviews = null;
    expect((await missing.run()).ok).toBe(false);
    const short = fixture();
    short.headers.set(rulesetsPath, {
      link: `<https://api.github.com${rulesetsPath.replace(/&page=1$/, "&page=2")}>; rel="next"`,
    });
    expect((await short.run()).ok).toBe(false);
  });

  test("reads complete paginated reviews, including an empty terminal page", async () => {
    for (const terminal of [[], [{ ...review, id: 200 }]]) {
      const f = fixture();
      f.routes.set(
        reviewsPath,
        Array.from({ length: 100 }, (_, i) => ({
          ...review,
          id: i + 1,
          user: { id: i + 100 },
          state: "COMMENTED",
        })),
      );
      const next = reviewsPath.replace(/&page=1$/, "&page=2");
      f.headers.set(reviewsPath, {
        link: `<https://api.github.com${next}>; rel="next", <https://api.github.com${next}>; rel="last"`,
      });
      f.routes.set(next, terminal);
      if (terminal.length === 0) f.rows(reviewsPath)[99] = { ...review, id: 100 };
      expect((await f.run()).ok).toBe(true);
      expect(f.requests.filter((path) => path === next)).toHaveLength(2);
    }
  });

  test("refuses incomplete, malicious, duplicated, missing, and over-bound review pages", async () => {
    for (const link of [
      "garbage",
      `<https://evil.example/steal>; rel="next"`,
      `<https://api.github.com${reviewsPath.replace(/&page=1$/, "&page=3")}>; rel="next"`,
      `<https://api.github.com${reviewsPath}>; rel="next"`,
    ]) {
      const f = fixture();
      f.headers.set(reviewsPath, { link });
      expect((await f.run()).ok).toBe(false);
      expect(f.requests.every((path) => !path.includes("evil"))).toBe(true);
    }
    for (const mode of ["duplicate", "missing", "bound"]) {
      const f = fixture();
      const pages = mode === "bound" ? 10 : 2;
      for (let page = 1; page <= pages; page += 1) {
        const path = reviewsPath.replace(/&page=1$/, `&page=${page}`);
        if (mode === "missing" && page === 2) continue;
        f.routes.set(
          path,
          Array.from({ length: 100 }, (_, i) => ({
            ...review,
            id: mode === "duplicate" ? i + 1 : (page - 1) * 100 + i + 1,
          })),
        );
      }
      expect((await f.run()).ok).toBe(false);
    }
  });

  test("rechecks authority identity and fails closed on provider failures without leaking errors", async () => {
    for (const target of [reviewsPath, prPath, protectionPath, "/repositories/123"]) {
      const f = fixture();
      f.mutate((path, value, count) => {
        if (path !== target || count !== 2) return value;
        if (path === reviewsPath) return [{ ...review, state: "DISMISSED" }];
        if (path === prPath) return { ...object(value), head: { sha: main, repo: { id: 123 } } };
        if (path === protectionPath)
          return { ...object(value), enforce_admins: { enabled: false } };
        return { ...object(value), permissions: { admin: false } };
      });
      expect((await f.run()).ok).toBe(false);
    }
    for (const status of [301, 403, 404, 429, 500]) {
      const f = fixture();
      f.mutate(() => new Response("fixture-token", { status }));
      expect(await f.run()).toEqual({ ok: false, issues: ["reviewProvider:refused"] });
    }
    const date = fixture();
    date.headers.set(prPath, { date: "not a date" });
    expect((await date.run()).ok).toBe(false);
  });
});

describe("stable review terminal publication", () => {
  let temporary: string;
  let checkout: string;
  let checkoutHead: string;
  let stableInputs: NonNullable<Awaited<ReturnType<typeof loadHostedStableInputs>>>;
  const git = (...args: string[]): string => {
    const result = spawnSync("git", ["-C", checkout, ...args], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  beforeAll(async () => {
    temporary = await realpath(await mkdtemp(resolve(tmpdir(), "op-review-terminal-")));
    checkout = resolve(temporary, "stable");
    await mkdir(checkout);
    for (const path of new Set([...iss002HarnessPaths, ...iss002TestBundlePaths])) {
      const destination = resolve(checkout, path);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(resolve(import.meta.dirname, "../..", path), destination);
    }
    git("init");
    git("config", "core.autocrlf", "false");
    git("add", ".");
    git(
      "-c",
      "user.name=Review Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "stable fixture",
    );
    checkoutHead = git("rev-parse", "HEAD");
    const loaded = await loadHostedStableInputs(checkout);
    if (!loaded) throw new Error("stable fixture inputs refused");
    stableInputs = loaded;
  }, 30_000);
  afterAll(async () => {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  });

  async function terminalFixture(
    arm: "PASS" | "BLOCK_REPLAN" = "BLOCK_REPLAN",
    changed: Record<string, string> = {},
  ) {
    const identities = {
      harnessBundleDigest: stableInputs.harnessBundleDigest,
      testBundleDigest: stableInputs.testBundleDigest,
      requiredJobRegistryDigest: stableInputs.requiredJobRegistryDigest,
      contractVersionsDigest: stableInputs.contractVersionsDigest,
      ...changed,
    };
    const subject = decision.computePortablePrimitivesStableHarnessSubjectDigest(
      identities.harnessBundleDigest,
      identities.testBundleDigest,
      identities.requiredJobRegistryDigest,
      identities.contractVersionsDigest,
    );
    const terminalCore = {
      ...core,
      ...identities,
      decision: arm,
      stableHarnessSubjectDigest: subject,
      decisionWriterDigest: decision.computePortablePrimitivesDecisionWriterDigest(
        subject,
        identities.harnessBundleDigest,
        identities.testBundleDigest,
        identities.contractVersionsDigest,
      ),
      ...(arm === "PASS"
        ? {
            aggregateDigest: digest("9"),
            diagnosticTerminalDigest: null,
            helperAbiDigests: [digest("1"), digest("2"), digest("3")],
            helperDigests: [digest("4"), digest("5"), digest("6")],
            osProfileDigests: [digest("7"), digest("8"), digest("9")],
            observationDigests: Array.from({ length: 63 }, (_, index) =>
              (index + 1).toString(16).padStart(64, "0"),
            ),
            profile: decision.portablePrimitivesCapabilityProfile,
          }
        : {}),
    };
    const terminalExpected = {
      ...expected,
      decisionCoreDigest:
        decision.computePortablePrimitivesCapabilityDecisionCoreDigest(terminalCore),
    };
    const f = fixture(canonicalBytes(terminalCore), terminalExpected);
    const comparisonPath = `${root}/compare/${checkoutHead}...${main}`;
    f.routes.set(comparisonPath, {
      status: "ahead",
      base_commit: { sha: checkoutHead },
      merge_base_commit: { sha: checkoutHead },
    });
    const output = await mkdtemp(resolve(temporary, "output-"));
    return {
      ...f,
      output,
      terminalCore,
      terminalExpected,
      comparisonPath,
      write: (outputRoot = output, stableRoot = checkout) =>
        writeHostedPortablePrimitivesReview(
          terminalExpected,
          "fixture-token",
          outputRoot,
          stableRoot,
          f.fetcher,
        ),
    };
  }

  test.each(["PASS", "BLOCK_REPLAN"] as const)(
    "publishes only the exact %s review/decision pair and never overwrites it",
    async (arm) => {
      const f = await terminalFixture(arm);
      const result = await f.write();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(await readdir(f.output)).toEqual(["decision.json", "independent-review.json"]);
      const reviewBytes = await readFile(resolve(f.output, "independent-review.json"));
      const decisionBytes = await readFile(resolve(f.output, "decision.json"));
      const reviewRecord = JSON.parse(reviewBytes.toString());
      const decisionRecord = JSON.parse(decisionBytes.toString());
      expect(reviewRecord.reviewDisposition).toBe(
        arm === "PASS" ? "AUTHORIZE_PASS" : "RECORD_BLOCK_REPLAN",
      );
      expect(reviewBytes).toEqual(Buffer.from(canonicalBytes(reviewRecord)));
      expect(decisionBytes).toEqual(Buffer.from(canonicalBytes(decisionRecord)));
      expect(
        decision.validatePortablePrimitivesCapabilityDecision(
          decisionRecord,
          f.terminalCore,
          reviewRecord,
        ).ok,
      ).toBe(true);
      expect(decision.computePortablePrimitivesIndependentReviewDigest(reviewRecord)).toBe(
        result.independentReviewReceiptDigest,
      );
      expect(decision.computePortablePrimitivesCapabilityDecisionDigest(decisionRecord)).toBe(
        result.decisionDigest,
      );
      expect((await f.write()).ok).toBe(false);
      expect(await readFile(resolve(f.output, "independent-review.json"))).toEqual(reviewBytes);
      expect(await readFile(resolve(f.output, "decision.json"))).toEqual(decisionBytes);
      expect(git("status", "--porcelain=v1", "--untracked-files=all")).toBe("");
      expect(f.requests.some((path) => path.includes("/actions/"))).toBe(false);
    },
    30_000,
  );

  test.each([
    "harnessBundleDigest",
    "testBundleDigest",
    "requiredJobRegistryDigest",
    "contractVersionsDigest",
  ])(
    "refuses a consistently rehashed foreign %s",
    async (field) => {
      const f = await terminalFixture("BLOCK_REPLAN", { [field]: digest("e") });
      expect(await f.write()).toEqual({ ok: false, issues: ["reviewStable:subject-mismatch"] });
      expect(await readdir(f.output)).toEqual([]);
    },
    30_000,
  );

  test("refuses unmerged/self-reviewed cores, foreign stable ancestry and source output", async () => {
    for (const mode of ["unmerged", "self", "ancestry", "source"]) {
      const f = await terminalFixture();
      if (mode === "unmerged") f.row(prPath).merged = false;
      if (mode === "self") f.routes.set(reviewsPath, [{ ...review, user: { id: 41 } }]);
      if (mode === "ancestry") f.row(f.comparisonPath).status = "diverged";
      expect((await f.write(mode === "source" ? checkout : f.output)).ok).toBe(false);
      expect(await readdir(f.output)).toEqual([]);
      expect(git("status", "--porcelain=v1", "--untracked-files=all")).toBe("");
    }
  }, 30_000);

  test("refuses dirty, changed-head and physically moved stable checkouts before output", async () => {
    const dirty = resolve(checkout, "untracked-fixture");
    const initial = await terminalFixture();
    await writeFile(dirty, "dirty");
    expect((await initial.write()).ok).toBe(false);
    expect(initial.requests).toEqual([]);
    await rm(dirty);
    for (const mode of ["dirty", "head", "physical"]) {
      const f = await terminalFixture();
      const aside = `${checkout}-aside`;
      f.mutate(async (path, value) => {
        if (path !== f.comparisonPath) return value;
        if (mode === "dirty") await writeFile(dirty, "dirty");
        if (mode === "head")
          git(
            "-c",
            "user.name=Review Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--allow-empty",
            "-m",
            "moved",
          );
        if (mode === "physical") await rename(checkout, aside);
        return value;
      });
      try {
        expect((await f.write()).ok).toBe(false);
        expect(await readdir(f.output)).toEqual([]);
      } finally {
        if (mode === "dirty") await rm(dirty);
        if (mode === "head") git("checkout", "--detach", checkoutHead);
        if (mode === "physical") await rename(aside, checkout);
      }
    }
  }, 30_000);
});
